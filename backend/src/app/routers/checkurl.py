from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional
from urllib.parse import urlparse
from datetime import datetime, timedelta
from sqlalchemy import select, insert, and_
import logging, re, hashlib

from ..db import async_session, rules, activity_events
from ..routers.auth import get_current_user

router = APIRouter(prefix="/check-url", tags=["check-url"])
logger = logging.getLogger(__name__)

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

WARNING_KEYWORDS = [
    "adult", "porn", "xxx", "sex", "nude", "dating", "violence",
    "gore", "drug", "weed", "cannabis", "gambling", "bet", "casino",
    "weapon", "gun", "hack", "torrent", "pirat",
]
BLOCK_KEYWORDS = ["child-abuse", "csam", "terrorism", "jihad", "darkweb"]

def keyword_check(domain: str):
    for kw in BLOCK_KEYWORDS:
        if kw in domain:
            return "block", f"Prohibited keyword: {kw}", 100
    for kw in WARNING_KEYWORDS:
        if kw in domain:
            return "warn", f"May contain age-restricted content ({kw})", 65
    return "safe", "", 10

async def log_event(session, child_id, domain, event_type, category):
    try:
        await session.execute(insert(activity_events).values(
            child_id=child_id,
            domain_hash=hash_domain(domain),
            domain=domain,
            event_type=event_type,
            blocked_category=category if event_type == "blocked" else None,
            event_date=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(days=3)
        ))
        await session.commit()
    except Exception as e:
        logger.warning(f"log_event failed: {e}")

async def evaluate_url(url: str, child_id: int) -> CheckUrlResponse:
    domain = extract_domain(url)
    async with async_session() as session:
        # Global rules
        result = await session.execute(
            select(rules).where(and_(rules.c.enabled == True))
        )
        for rule in result.fetchall():
            if domain_matches(rule.pattern, domain):
                if rule.rule_type == "blocklist":
                    await log_event(session, child_id, domain, "blocked", rule.category or "rule")
                    return CheckUrlResponse(blocked=True, warning=False, risk_score=90,
                        reason=rule.explanation or "Blocked by GuardianLens rules",
                        category=rule.category, domain=domain)
                elif rule.rule_type == "allowlist":
                    await log_event(session, child_id, domain, "visit", "allowlist")
                    return CheckUrlResponse(blocked=False, warning=False, risk_score=5,
                        reason="Approved site", category=rule.category, domain=domain)
        # Keyword fallback
        decision, reason, score = keyword_check(domain)
        if decision == "block":
            await log_event(session, child_id, domain, "blocked", "keyword_filter")
            return CheckUrlResponse(blocked=True, warning=False, risk_score=score,
                reason=reason, category="prohibited", domain=domain)
        if decision == "warn":
            await log_event(session, child_id, domain, "visit", "warning")
            return CheckUrlResponse(blocked=False, warning=True, risk_score=score,
                reason=reason, category="age_restricted", domain=domain)
        await log_event(session, child_id, domain, "visit", "safe")
        return CheckUrlResponse(blocked=False, warning=False, risk_score=score,
            reason="Site appears safe", category=None, domain=domain)

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