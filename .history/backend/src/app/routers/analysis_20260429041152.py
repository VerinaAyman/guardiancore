from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, Field
from typing import Optional
from urllib.parse import urlparse
from sqlalchemy import insert, select
import logging

from ..services.classifier import classifier
from ..services.pipeline import BLOCK_THRESHOLD, WARN_THRESHOLD, run_pipeline
from ..db import async_session, child_rules, users
from ..routers.auth import get_current_user

router = APIRouter(prefix="/analyze", tags=["analysis"])
logger = logging.getLogger(__name__)


class ContentAnalysisRequest(BaseModel):
    url: str = Field(..., description="The URL to analyze")
    text_content: str = Field(default="", description="Page text content")
    child_age: int = Field(default=13, description="Child age for Consent Maturity Ladder")


class ContentAnalysisResponse(BaseModel):
    safe: bool
    action: str
    blocked_by: Optional[str] = None
    category: Optional[str] = None
    confidence: Optional[float] = None
    matched_keyword: Optional[str] = None
    rule_created: bool = False
    domain: Optional[str] = None
    trigger_words: Optional[list] = None
    parent_report: Optional[str] = None
    child_message: Optional[str] = None
    risk_score: Optional[float] = 0.0
    stage: Optional[int] = None


def extract_domain(url: str) -> str:
    try:
        parsed = urlparse(url)
        hostname = parsed.netloc.lower()
        if hostname.startswith("www."):
            hostname = hostname[4:]
        return hostname
    except Exception:
        return ""


@router.post("/content", response_model=ContentAnalysisResponse)
async def analyze_content(
    request: ContentAnalysisRequest,
    current_user: dict = Depends(get_current_user)
):
    rule_created = False
    blocked_domain = None

    try:
        domain = extract_domain(request.url)

        # Layer 0: Allowlist check
        if domain and current_user["account_type"] == "child":
            async with async_session() as session:
                allowlist_result = await session.execute(
                    select(child_rules).where(
                        child_rules.c.pattern == domain,
                        child_rules.c.rule_type == "allowlist",
                        child_rules.c.target_type == "child",
                        child_rules.c.target_id == current_user["user_id"],
                        child_rules.c.enabled == True
                    )
                )
                if allowlist_result.fetchone():
                    return ContentAnalysisResponse(safe=True, action="none")

        # Layer 1: URL keyword check
        text_content = request.text_content[:2000] if request.text_content else ""
        result = await classifier.predict(request.url, text_content)

        logger.info(f"[Analysis] Classifier result: safe={result['safe']} | blocked_by={result.get('blocked_by')}")

        # If Groq already decided the action, use it directly
        if result.get('blocked_by') == 'groq_classification':
            groq_action = result.get('action', 'none')
            return ContentAnalysisResponse(
                safe=(groq_action == 'none'),
                action=groq_action,
                blocked_by='groq_classification' if groq_action != 'none' else None,
                category=result.get('category'),
                confidence=result.get('confidence'),
                domain=domain,
                risk_score=result.get('confidence') or 0.0
            )

        # If URL keyword blocked, always block
        if result.get('blocked_by') == 'url_keywords':
            return ContentAnalysisResponse(
                safe=False,
                action='block',
                blocked_by='url_keywords',
                category=result.get('category'),
                confidence=result.get('confidence'),
                domain=domain,
                risk_score=1.0
            )

        if not result["safe"] and result.get("blocked_by") == "url_keywords" and (result.get("confidence") or 0.0) < BLOCK_THRESHOLD:
            return ContentAnalysisResponse(
                safe=True,
                action="none",
                blocked_by=result.get("blocked_by"),
                category=result.get("category"),
                confidence=result.get("confidence"),
                matched_keyword=result.get("matched_keyword"),
                domain=domain,
                risk_score=result.get("confidence") or 0.0,
            )

        if not result["safe"]:
            blocked_domain = domain
            if domain:
                try:
                    async with async_session() as session:
                        if result["blocked_by"] == "url_keywords":
                            explanation = f"Auto-blocked: URL contains '{result['matched_keyword']}'"
                        else:
                            conf = result.get('confidence', 0)
                            explanation = f"Auto-blocked: {result.get('category', 'unsafe')} detected ({conf:.0%})"

                        category = result.get("category") or "unsafe_content"

                        if current_user["account_type"] == "child":
                            child_result = await session.execute(
                                select(users.c.parent_id).where(users.c.id == current_user["user_id"])
                            )
                            child_row = child_result.fetchone()
                            if child_row and child_row.parent_id:
                                existing = await session.execute(
                                    select(child_rules).where(
                                        child_rules.c.pattern == domain,
                                        child_rules.c.rule_type == "blocklist",
                                        child_rules.c.target_type == "child",
                                        child_rules.c.target_id == current_user["user_id"]
                                    )
                                )
                                if not existing.fetchone():
                                    await session.execute(
                                        insert(child_rules).values(
                                            rule_type="blocklist",
                                            pattern=domain,
                                            category=category,
                                            explanation=explanation,
                                            enabled=True,
                                            target_type="child",
                                            target_id=current_user["user_id"],
                                            created_by=child_row.parent_id
                                        )
                                    )
                                    await session.commit()
                                    rule_created = True
                except Exception as db_error:
                    logger.error(f"[Analysis] Rule creation failed: {db_error}")

            # Generate narrative even for fast-path blocks
            narrative = {"stage": 3, "parent_report": "", "child_message": ""}
            if text_content:
                from ..services.pipeline import phase4_generate_narrative
                narrative = phase4_generate_narrative(
                    original_text=text_content,
                    risk_label=result.get("category") or result.get("blocked_by") or "restricted",
                    confidence=result.get("confidence") or 1.0,
                    trigger_words=[result.get("matched_keyword")] if result.get("matched_keyword") else [],
                    child_age=request.child_age
                )

            return ContentAnalysisResponse(
                safe=False,
                action="blocked",
                blocked_by=result["blocked_by"],
                category=result.get("category"),
                confidence=result.get("confidence"),
                matched_keyword=result.get("matched_keyword"),
                rule_created=rule_created,
                domain=blocked_domain,
                trigger_words=[result.get("matched_keyword")] if result.get("matched_keyword") else [],
                parent_report=narrative["parent_report"],
                child_message=narrative["child_message"],
                stage=narrative["stage"],
                risk_score=result.get("confidence") or 0.0
            )

        return ContentAnalysisResponse(safe=True, action="none", risk_score=0.0)

    except Exception as e:
        logger.error(f"[Analysis] Failed, allowing (fail-open): {e}", exc_info=True)
        return ContentAnalysisResponse(safe=True, action="none")


@router.get("/health")
async def analysis_health():
    from ..config import settings
    return {
        "status": "healthy",
        "classifier_enabled": bool(settings.HUGGINGFACE_API_KEY),
        "pipeline_enabled": bool(settings.ANTHROPIC_API_KEY)
    }