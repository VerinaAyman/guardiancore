from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from urllib.parse import urlparse
from datetime import datetime, timedelta
from sqlalchemy import select, insert, and_
import logging, re, hashlib, os
import httpx

from ..db import async_session, rules, activity_events
from ..routers.auth import get_current_user

router = APIRouter(prefix="/check-url", tags=["check-url"])
logger = logging.getLogger(__name__)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"


class CheckUrlRequest(BaseModel):
    url: str
    child_id: Optional[int] = None


class CheckUrlResponse(BaseModel):
    blocked: bool
    warning: bool
    risk_score: int
    reason: str
    category: Optional[str]
    domain: str


def extract_domain(url: str) -> str:
    try:
        parsed = urlparse(url)
        host = parsed.netloc or parsed.path
        host = host.split(":")[0].strip()
        if host.startswith("www."):
            host = host[4:]
        return host.lower()
    except Exception:
        return url.lower()


def domain_matches(pattern: str, domain: str) -> bool:
    pattern = pattern.lower().strip()
    domain = domain.lower().strip()
    if pattern == domain:
        return True
    if "*" in pattern:
        regex = re.escape(pattern).replace(r"\*", ".*")
        return bool(re.fullmatch(regex, domain))
    if "." not in pattern:
        return pattern in domain
    if domain.endswith("." + pattern):
        return True
    return False


def hash_domain(domain: str) -> str:
    return hashlib.sha256(domain.encode()).hexdigest()


# Hard block keywords — always block no matter what
BLOCK_KEYWORDS = ["child-abuse", "csam", "terrorism", "jihad", "darkweb"]

# Fast keyword pre-check before calling AI
WARNING_KEYWORDS = [
    "adult", "porn", "xxx", "sex", "nude", "dating", "violence",
    "gore", "drug", "weed", "cannabis", "gambling", "bet", "casino",
    "weapon", "gun", "hack", "torrent", "pirat",
]

# Domains that are always safe — skip AI for these
SAFE_DOMAINS = {
    "google.com", "apple.com", "microsoft.com", "youtube.com",
    "wikipedia.org", "github.com", "stackoverflow.com", "cloudflare.com",
    "icloud.com", "gstatic.com", "googleapis.com",
}


def keyword_precheck(domain: str):
    for kw in BLOCK_KEYWORDS:
        if kw in domain:
            return "block", f"Prohibited keyword: {kw}", 100
    for kw in WARNING_KEYWORDS:
        if kw in domain:
            return "warn", f"May contain age-restricted content ({kw})", 65
    return None, "", 0


async def ai_classify(domain: str) -> tuple[str, str, int]:
    """
    Ask Groq to classify the domain.
    Returns ("block"|"warn"|"safe"), reason, risk_score
    """
    if not GROQ_API_KEY:
        return "safe", "AI unavailable", 10

    prompt = (
        f"You are a child safety content classifier. "
        f"Classify the website domain '{domain}' for a child aged 8-16.\n\n"
        f"Respond ONLY with a JSON object, no markdown, no explanation:\n"
        f'{{"decision": "block"|"warn"|"safe", "reason": "short reason", "risk_score": 0-100}}\n\n'
        f"Rules:\n"
        f"- block: porn, gambling, extreme violence, drugs, weapons, dark web\n"
        f"- warn: social media, forums, chat platforms, gaming, news with mature themes, dating\n"
        f"- safe: educational, search engines, kids content, productivity tools\n"
        f"Domain: {domain}"
    )

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                GROQ_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": GROQ_MODEL,
                    "max_tokens": 100,
                    "temperature": 0,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=5.0,
            )
            if resp.status_code != 200:
                logger.warning(f"Groq returned {resp.status_code}")
                return "safe", "AI unavailable", 10

            content = resp.json()["choices"][0]["message"]["content"].strip()
            # Strip markdown fences if present
            content = content.replace("```json", "").replace("```", "").strip()
            import json
            data = json.loads(content)
            decision   = data.get("decision", "safe")
            reason     = data.get("reason", "")
            risk_score = int(data.get("risk_score", 10))
            if decision not in ("block", "warn", "safe"):
                decision = "safe"
            return decision, reason, risk_score

    except Exception as e:
        logger.warning(f"AI classification failed for {domain}: {e}")
        return "safe", "AI unavailable", 10


async def log_event(session, child_id, domain, event_type, category):
    try:
        await session.execute(insert(activity_events).values(
            child_id=child_id,
            domain_hash=hash_domain(domain),
            domain=domain,
            event_type=event_type,
            blocked_category=category if event_type in ("blocked", "warning") else None,
            event_date=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(days=3),
        ))
        await session.commit()
    except Exception as e:
        logger.warning(f"log_event failed: {e}")


async def evaluate_url(url: str, child_id: int) -> CheckUrlResponse:
    domain = extract_domain(url)

    async with async_session() as session:
        # 1. Check explicit rules first (parent-defined block/allowlists)
        result = await session.execute(
            select(rules).where(rules.c.enabled == True)
        )
        for rule in result.fetchall():
            if domain_matches(rule.pattern, domain):
                if rule.rule_type == "blocklist":
                    await log_event(session, child_id, domain, "blocked", rule.category or "rule")
                    return CheckUrlResponse(
                        blocked=True, warning=False, risk_score=90,
                        reason=rule.explanation or "Blocked by GuardianLens rules",
                        category=rule.category, domain=domain,
                    )
                elif rule.rule_type == "allowlist":
                    await log_event(session, child_id, domain, "visit", "allowlist")
                    return CheckUrlResponse(
                        blocked=False, warning=False, risk_score=5,
                        reason="Approved site", category=rule.category, domain=domain,
                    )

        # 2. Always-safe domains — skip AI
        for safe in SAFE_DOMAINS:
            if domain == safe or domain.endswith("." + safe):
                await log_event(session, child_id, domain, "visit", "safe")
                return CheckUrlResponse(
                    blocked=False, warning=False, risk_score=5,
                    reason="Safe domain", category=None, domain=domain,
                )

        # 3. Hard keyword block (instant, no AI needed)
        pre_decision, pre_reason, pre_score = keyword_precheck(domain)
        if pre_decision == "block":
            await log_event(session, child_id, domain, "blocked", "keyword_filter")
            return CheckUrlResponse(
                blocked=True, warning=False, risk_score=pre_score,
                reason=pre_reason, category="prohibited", domain=domain,
            )

        # 4. AI classification
        decision, reason, risk_score = await ai_classify(domain)

        if decision == "block":
            await log_event(session, child_id, domain, "blocked", "ai_blocked")
            return CheckUrlResponse(
                blocked=True, warning=False, risk_score=risk_score,
                reason=reason, category="ai_blocked", domain=domain,
            )

        if decision == "warn" or pre_decision == "warn":
            await log_event(session, child_id, domain, "warning", "warning")
            return CheckUrlResponse(
                blocked=False, warning=True, risk_score=risk_score or pre_score,
                reason=reason or pre_reason, category="age_restricted", domain=domain,
            )

        # 5. Safe
        await log_event(session, child_id, domain, "visit", "safe")
        return CheckUrlResponse(
            blocked=False, warning=False, risk_score=risk_score,
            reason="Site appears safe", category=None, domain=domain,
        )


@router.post("/", response_model=CheckUrlResponse)
async def check_url(payload: CheckUrlRequest, current_user: dict = Depends(get_current_user)):
    if current_user["account_type"] == "child":
        child_id = current_user["user_id"]
    elif current_user["account_type"] == "parent" and payload.child_id:
        child_id = payload.child_id
    else:
        raise HTTPException(status_code=400, detail="child_id required for parent accounts")
    if not payload.url or not payload.url.strip():
        raise HTTPException(status_code=400, detail="url is required")
    return await evaluate_url(payload.url, child_id)