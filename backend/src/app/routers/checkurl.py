from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from urllib.parse import urlparse
from datetime import datetime, timedelta
from sqlalchemy import select, insert, and_
import logging, re, hashlib, os, json
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


# ─── Infrastructure-only safe domains ────────────────────────────────────────
# ONLY domains that break the phone/OS if blocked.
# Social media, search engines, news — all go through AI now.
INFRASTRUCTURE_DOMAINS = {
    # Apple OS & device services
    "apple.com", "icloud.com", "cdn.apple.com", "mzstatic.com",
    "apple-dns.net", "applecdn.net", "apple-cloudkit.com",
    "push.apple.com", "gateway.icloud.com", "itunes.apple.com",
    # Google infrastructure (not YouTube/Search — AI handles those)
    "googleapis.com", "gstatic.com", "googleusercontent.com",
    # Cloudflare & CDN infrastructure
    "cloudflare.com", "cloudflare-dns.com",
    "akamai.net", "akamaihd.net", "fastly.net",
    # WhatsApp transport layer (not content — DNS can't see messages)
    "whatsapp.net",
    # Microsoft OS services
    "windows.com", "windowsupdate.com", "microsoft.com",
    # Your own backend — never block
    "railway.app",
}


# ─── Hard block keywords ─────────────────────────────────────────────────────
# Only truly unambiguous CSAM / terrorism / darkweb — instant block, no AI.
BLOCK_KEYWORDS = ["child-abuse", "csam", "terrorism", "jihad", "darkweb", "onion"]


async def ai_classify(domain: str) -> tuple[str, str, int]:
    """
    Ask Groq to classify the domain.
    Returns ("block"|"warn"|"safe"), reason, risk_score
    Falls back to "warn" (not "safe") on failure — err on the side of caution.
    """
    if not GROQ_API_KEY:
        logger.warning("GROQ_API_KEY not set — defaulting to warn")
        return "warn", "AI unavailable — flagged for caution", 50

    prompt = (
        f"You are a child safety content classifier for a parental control app. "
        f"Classify the website domain '{domain}' for a child aged 8-16.\n\n"
        f"Respond ONLY with a JSON object, no markdown, no explanation:\n"
        f'{{"decision": "block"|"warn"|"safe", "reason": "short reason under 10 words", "risk_score": 0-100}}\n\n'
        f"Classification rules:\n"
        f"- block (risk 75-100): porn, explicit content, gambling, extreme violence, drugs, weapons, dark web, hate sites\n"
        f"- warn (risk 40-74): social media (Facebook, Instagram, TikTok, Twitter/X, Snapchat, Discord), "
        f"forums, chat platforms, gaming sites, news with mature themes, dating apps, "
        f"YouTube (due to unmoderated content), Reddit, Twitch\n"
        f"- safe (risk 0-39): educational sites, search engines (Google, Bing), "
        f"kids content, productivity tools, coding resources, Wikipedia, "
        f"trusted news (BBC, Reuters), shopping (Amazon)\n\n"
        f"Domain to classify: {domain}"
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
                    "max_tokens": 120,
                    "temperature": 0,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=5.0,
            )
            if resp.status_code != 200:
                logger.error(f"Groq ERROR {resp.status_code} for {domain}: {resp.text[:500]}")
                return "warn", "AI unavailable — flagged for caution", 50

            content = resp.json()["choices"][0]["message"]["content"].strip()
            content = content.replace("```json", "").replace("```", "").strip()
            data = json.loads(content)
            decision   = data.get("decision", "warn")
            reason     = data.get("reason", "")
            risk_score = int(data.get("risk_score", 50))
            if decision not in ("block", "warn", "safe"):
                decision = "warn"
            return decision, reason, risk_score

    except json.JSONDecodeError as e:
        logger.warning(f"AI JSON parse failed for {domain}: {e} — raw: {content[:100]}")
        return "warn", "AI response parse error", 50
    except Exception as e:
        logger.warning(f"AI classification failed for {domain}: {e}")
        return "warn", "AI unavailable — flagged for caution", 50


async def log_event(session, child_id, domain, event_type, category):
    try:
        now = datetime.utcnow()
        domain_hash = hashlib.sha256(
            f"{domain}:{child_id}:{event_type}:{now.isoformat()}".encode()
        ).hexdigest()
        await session.execute(
            activity_events.insert().values(
                child_id=child_id,
                domain_hash=domain_hash,
                domain=domain,
                event_type=event_type,
                blocked_category=category if event_type in ("blocked", "warning") else None,
                event_date=now,
                expires_at=now + timedelta(days=3),
            )
        )
        await session.commit()
    except Exception as e:
        logger.warning(f"log_event failed: {e}")


async def evaluate_url(url: str, child_id: int) -> CheckUrlResponse:
    """
    Core classification logic. Called directly by dnsprofile.py (no HTTP, no auth needed).
    Also exposed via the /check-url/ POST endpoint for authenticated external callers.
    """
    domain = extract_domain(url)

    async with async_session() as session:
        # 1. Parent-defined explicit rules (highest priority)
        result = await session.execute(
            select(rules).where(rules.c.enabled == True)
        )
        for rule in result.fetchall():
            if domain_matches(rule.pattern, domain):
                if rule.rule_type == "blocklist":
                    await log_event(session, child_id, domain, "blocked", rule.category or "rule")
                    return CheckUrlResponse(
                        blocked=True, warning=False, risk_score=95,
                        reason=rule.explanation or "Blocked by parent rules",
                        category=rule.category, domain=domain,
                    )
                elif rule.rule_type == "allowlist":
                    await log_event(session, child_id, domain, "visit", "allowlist")
                    return CheckUrlResponse(
                        blocked=False, warning=False, risk_score=5,
                        reason="Approved by parent", category="allowlist", domain=domain,
                    )

        # 2. Infrastructure passthrough — skip AI, never block
        for infra in INFRASTRUCTURE_DOMAINS:
            if domain == infra or domain.endswith("." + infra):
                await log_event(session, child_id, domain, "visit", "safe")
                return CheckUrlResponse(
                    blocked=False, warning=False, risk_score=0,
                    reason="System infrastructure", category="infrastructure", domain=domain,
                )

        # 3. Hard keyword block — instant, no AI needed
        for kw in BLOCK_KEYWORDS:
            if kw in domain:
                await log_event(session, child_id, domain, "blocked", "keyword_filter")
                return CheckUrlResponse(
                    blocked=True, warning=False, risk_score=100,
                    reason=f"Prohibited content: {kw}",
                    category="prohibited", domain=domain,
                )

        # 4. AI classification — handles everything else
        decision, reason, risk_score = await ai_classify(domain)

        if decision == "block":
            await log_event(session, child_id, domain, "blocked", "ai_blocked")
            return CheckUrlResponse(
                blocked=True, warning=False, risk_score=risk_score,
                reason=reason, category="ai_blocked", domain=domain,
            )

        if decision == "warn":
            await log_event(session, child_id, domain, "warning", "ai_warning")
            return CheckUrlResponse(
                blocked=False, warning=True, risk_score=risk_score,
                reason=reason, category="age_restricted", domain=domain,
            )

        # 5. Safe
        await log_event(session, child_id, domain, "visit", "safe")
        return CheckUrlResponse(
            blocked=False, warning=False, risk_score=risk_score,
            reason=reason or "Site appears safe", category=None, domain=domain,
        )


@router.post("/", response_model=CheckUrlResponse)
async def check_url(payload: CheckUrlRequest, current_user: dict = Depends(get_current_user)):
    """Authenticated endpoint for external callers (browser extension, manual checks)."""
    if current_user["account_type"] == "child":
        child_id = current_user["user_id"]
    elif current_user["account_type"] == "parent" and payload.child_id:
        child_id = payload.child_id
    else:
        raise HTTPException(status_code=400, detail="child_id required for parent accounts")
    if not payload.url or not payload.url.strip():
        raise HTTPException(status_code=400, detail="url is required")
    return await evaluate_url(payload.url, child_id)