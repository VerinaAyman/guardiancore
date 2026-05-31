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


# ── NEW: Chat analysis models ──────────────────────────────────────────────────
class ChatAnalysisRequest(BaseModel):
    url: str = Field(default="", description="Platform URL e.g. web.whatsapp.com")
    messages: str = Field(..., description="Chat messages to analyze")
    child_age: int = Field(default=13)


class ChatAnalysisResponse(BaseModel):
    safe: bool
    action: str
    category: Optional[str] = None
    confidence: Optional[float] = None
    reason: Optional[str] = None
    detected_patterns: Optional[list] = None


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

        # Layer 1: URL keyword check + Groq classification
        text_content = request.text_content[:2000] if request.text_content else ""
        result = await classifier.predict(request.url, text_content)

        logger.info(f"[Analysis] Classifier result: safe={result['safe']} | blocked_by={result.get('blocked_by')} | action={result.get('action')} | category={result.get('category')}")

        # If Groq ran, use its decision directly
        if result.get('blocked_by') == 'groq_classification':
            groq_action = result.get('action', 'none')
            groq_category = result.get('category', '')
            groq_confidence = result.get('confidence', 0.0)

            if groq_action == 'block':
                return ContentAnalysisResponse(
                    safe=False, action='block', blocked_by='groq_classification',
                    category=groq_category, confidence=groq_confidence,
                    domain=domain, risk_score=groq_confidence
                )
            elif groq_action == 'warn':
                return ContentAnalysisResponse(
                    safe=False, action='warn', blocked_by='groq_classification',
                    category=groq_category, confidence=groq_confidence,
                    domain=domain, risk_score=groq_confidence
                )
            else:
                return ContentAnalysisResponse(
                    safe=True, action='none', blocked_by=None,
                    category=groq_category, confidence=groq_confidence,
                    domain=domain, risk_score=groq_confidence
                )

        # If URL keyword blocked, always block
        if result.get('blocked_by') == 'url_keywords':
            return ContentAnalysisResponse(
                safe=False, action='block', blocked_by='url_keywords',
                category=result.get('category'), confidence=result.get('confidence'),
                domain=domain, risk_score=1.0
            )

        if not result["safe"] and result.get("blocked_by") == "url_keywords" and (result.get("confidence") or 0.0) < BLOCK_THRESHOLD:
            return ContentAnalysisResponse(
                safe=True, action="none",
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
                safe=False, action="blocked",
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


# ── NEW: Chat grooming/slang detection endpoint ────────────────────────────────
@router.post("/chat", response_model=ChatAnalysisResponse)
async def analyze_chat(
    request: ChatAnalysisRequest,
    current_user: dict = Depends(get_current_user)
):
    try:
        groq_result = await classifier._classify_with_groq(
            url=request.url or "chat",
            text_content=request.messages,
            child_age=request.child_age,
            is_chat=True
        )

        if not groq_result:
            return ChatAnalysisResponse(safe=True, action="none")

        action = groq_result.get('action', 'none')
        confidence = groq_result.get('confidence', 0.0)
        if action in ('block', 'warn') and confidence < 0.85:
            action = 'none'
        return ChatAnalysisResponse(
            safe=(action == 'none'),
            action=action,
            category=groq_result.get('category'),
            confidence=groq_result.get('confidence'),
            reason=groq_result.get('reason'),
            detected_patterns=groq_result.get('detected_patterns', [])
        )
    except Exception as e:
        logger.error(f"[Chat Analysis] Failed: {e}", exc_info=True)
        return ChatAnalysisResponse(safe=True, action="none")
@router.post("/chat/debug")
async def debug_chat(
    request: ChatAnalysisRequest,
    current_user: dict = Depends(get_current_user)
):
    import os, traceback
    from groq import Groq
    import re, json

    groq_api_key = os.environ.get('GROQ_API_KEY')
    result = {
        "key_present": bool(groq_api_key),
        "key_prefix": groq_api_key[:8] + "..." if groq_api_key else None,
        "raw_response": None,
        "after_strip": None,
        "parse_error": None,
        "parsed": None
    }

    try:
        client = Groq(api_key=groq_api_key)
        response = client.chat.completions.create(
            model='llama-3.3-70b-versatile',
            messages=[
                {'role': 'system', 'content': 'You are a child safety AI. Return JSON only with keys: category, risk_score, action, reason, detected_patterns.'},
                {'role': 'user', 'content': f'Analyze this chat for grooming: {request.messages}\nReturn JSON only.'}
            ],
            temperature=0.1
        )
        raw = response.choices[0].message.content.strip()
        result["raw_response"] = raw

        cleaned = re.sub(r'^```(?:json)?\s*', '', raw)
        cleaned = re.sub(r'\s*```$', '', cleaned).strip()
        result["after_strip"] = cleaned

        parsed = json.loads(cleaned)
        result["parsed"] = parsed

    except Exception as e:
        result["parse_error"] = traceback.format_exc()

    return result

@router.get("/health")
async def analysis_health():
    from ..config import settings
    return {
        "status": "healthy",
        "classifier_enabled": bool(settings.HUGGINGFACE_API_KEY),
        "pipeline_enabled": bool(settings.ANTHROPIC_API_KEY)
    }