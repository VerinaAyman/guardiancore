"""
lens.py — GuardianLens Lens chatbot backend router
Mount in main.py with: app.include_router(lens_router)

Responsibilities:
  - Store and retrieve the parent's Groq API key (encrypted via crypto.py)
  - Expose /lens/config so the extension can fetch the key securely after JWT auth
  - Receive LENS_ESCALATE events and log them + fire notify.py
  - Provide /lens/thresholds so parents can tune risk thresholds from options.html

Add to db.py tables:  lens_config (parent_id, groq_key_enc, guide_threshold, escalate_threshold)
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
import logging

# These already exist in your codebase — adjust import paths to match yours
from .auth import get_current_user          # returns current Account
from .crypto import encrypt, decrypt        # Fernet helpers from crypto.py
from .db import get_db, AsyncSession        # async DB session
from .notify import send_parent_alert       # already exists in notify.py
from sqlalchemy import text

logger = logging.getLogger(__name__)
lens_router = APIRouter(prefix="/lens", tags=["lens"])


# ─── Pydantic schemas ────────────────────────────────────────────────────────

class LensConfigUpdate(BaseModel):
    groq_key: str                    # raw key, encrypted before storing
    guide_threshold: int = 40        # risk score to start a chat (0-100)
    escalate_threshold: int = 85     # risk score to skip chat & alert parents


class LensEscalateEvent(BaseModel):
    child_id: int
    domain: str
    category: str
    risk_score: Optional[int] = 100


class LensThresholdUpdate(BaseModel):
    guide_threshold: int
    escalate_threshold: int


# ─── Helpers ─────────────────────────────────────────────────────────────────

async def get_lens_config(parent_id: int, db: AsyncSession) -> dict:
    """Fetch Lens config row for a parent, creating defaults if missing."""
    result = await db.execute(
        text("SELECT groq_key_enc, guide_threshold, escalate_threshold "
             "FROM lens_config WHERE parent_id = :pid"),
        {"pid": parent_id}
    )
    row = result.fetchone()
    if not row:
        # Insert default row (no key set yet)
        await db.execute(
            text("INSERT INTO lens_config (parent_id, groq_key_enc, guide_threshold, escalate_threshold) "
                 "VALUES (:pid, NULL, 40, 85)"),
            {"pid": parent_id}
        )
        await db.commit()
        return {"groq_key": None, "guide_threshold": 40, "escalate_threshold": 85}

    groq_key = decrypt(row[0]) if row[0] else None
    return {
        "groq_key": groq_key,
        "guide_threshold": row[1],
        "escalate_threshold": row[2]
    }


# ─── Routes ──────────────────────────────────────────────────────────────────

@lens_router.get("/config")
async def get_lens_cfg(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Called by the extension background.js after child login.
    Returns Groq key and thresholds so lens-bubble.js can operate.
    Only returns config if the logged-in parent has set it up.
    The key is returned in plaintext over HTTPS — never logged.
    """
    if current_user.account_type not in ("parent", "child"):
        raise HTTPException(status_code=403, detail="Not authorized")

    # For child accounts, look up their parent's config
    parent_id = current_user.id
    if current_user.account_type == "child":
        result = await db.execute(
            text("SELECT parent_id FROM children WHERE id = :cid"),
            {"cid": current_user.id}
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Child record not found")
        parent_id = row[0]

    cfg = await get_lens_config(parent_id, db)
    return {
        "lens_enabled": cfg["groq_key"] is not None,
        "groq_key": cfg["groq_key"],           # sent over HTTPS only
        "guide_threshold": cfg["guide_threshold"],
        "escalate_threshold": cfg["escalate_threshold"]
    }


@lens_router.put("/config")
async def update_lens_cfg(
    payload: LensConfigUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Parent saves their Groq API key and thresholds from options.html."""
    if current_user.account_type != "parent":
        raise HTTPException(status_code=403, detail="Parents only")

    encrypted_key = encrypt(payload.groq_key)

    await db.execute(
        text("""
            INSERT INTO lens_config (parent_id, groq_key_enc, guide_threshold, escalate_threshold)
            VALUES (:pid, :key, :gt, :et)
            ON CONFLICT (parent_id) DO UPDATE
              SET groq_key_enc = :key,
                  guide_threshold = :gt,
                  escalate_threshold = :et
        """),
        {
            "pid": current_user.id,
            "key": encrypted_key,
            "gt": payload.guide_threshold,
            "et": payload.escalate_threshold
        }
    )
    await db.commit()
    return {"status": "ok", "message": "Lens configured successfully"}


@lens_router.put("/thresholds")
async def update_thresholds(
    payload: LensThresholdUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Parent adjusts sensitivity without touching their API key."""
    if current_user.account_type != "parent":
        raise HTTPException(status_code=403, detail="Parents only")

    await db.execute(
        text("UPDATE lens_config SET guide_threshold = :gt, escalate_threshold = :et "
             "WHERE parent_id = :pid"),
        {"gt": payload.guide_threshold, "et": payload.escalate_threshold, "pid": current_user.id}
    )
    await db.commit()
    return {"status": "ok"}


@lens_router.post("/escalate")
async def lens_escalate(
    payload: LensEscalateEvent,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Called by background.js when lens-bubble.js fires LENS_ESCALATE.
    Logs the event and triggers parent email via notify.py.
    """
    if current_user.account_type != "child":
        raise HTTPException(status_code=403, detail="Child accounts only")

    logger.warning(
        f"LENS ESCALATE: child={current_user.id} domain={payload.domain} "
        f"category={payload.category} risk={payload.risk_score}"
    )

    # Log to audit_events (reuse your existing audit pattern)
    await db.execute(
        text("""
            INSERT INTO audit_events (account_id, event_type, domain, details, created_at)
            VALUES (:aid, 'lens_escalate', :domain, :details, NOW())
        """),
        {
            "aid": current_user.id,
            "domain": payload.domain,
            "details": f"category={payload.category} risk={payload.risk_score} source=lens"
        }
    )
    await db.commit()

    # Fire parent notification via your existing notify.py
    try:
        await send_parent_alert(
            child_id=payload.child_id,
            domain=payload.domain,
            category=payload.category,
            source="Lens chatbot",
            db=db
        )
    except Exception as e:
        logger.error(f"Lens escalate notify failed: {e}")
        # Don't raise — the escalation is already logged

    return {"status": "escalated", "message": "Parent notified"}


@lens_router.delete("/config")
async def disable_lens(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Parent disables Lens by removing their API key."""
    if current_user.account_type != "parent":
        raise HTTPException(status_code=403, detail="Parents only")

    await db.execute(
        text("UPDATE lens_config SET groq_key_enc = NULL WHERE parent_id = :pid"),
        {"pid": current_user.id}
    )
    await db.commit()
    return {"status": "ok", "message": "Lens disabled"}
