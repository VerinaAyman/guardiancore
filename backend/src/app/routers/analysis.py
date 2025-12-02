"""Content Analysis Router for intelligent content classification.

Provides endpoints for:
- POST /analyze/content - Analyze URL and page content for safety
"""

from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, Field
from typing import Optional
from urllib.parse import urlparse
from sqlalchemy import insert
from datetime import datetime
import logging

from ..services.classifier import classifier
from ..db import async_session, child_rules
from ..routers.auth import get_current_user

router = APIRouter(prefix="/analyze", tags=["analysis"])
logger = logging.getLogger(__name__)


class ContentAnalysisRequest(BaseModel):
    url: str = Field(..., description="The URL to analyze")
    text_content: str = Field(default="", description="Page text content (truncated to 1000 chars)")


class ContentAnalysisResponse(BaseModel):
    safe: bool
    action: str  # "blocked" or "none"
    blocked_by: Optional[str] = None  # "url_keywords" or "content_analysis"
    category: Optional[str] = None
    confidence: Optional[float] = None
    matched_keyword: Optional[str] = None


def extract_domain(url: str) -> str:
    """Extract domain from URL for rule creation."""
    try:
        parsed = urlparse(url)
        hostname = parsed.netloc.lower()
        # Remove www. prefix
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
    """
    Analyze URL and page content for safety using two-layer classification.
    
    Layer 1 (Fast Path): URL tokenization and keyword matching
    Layer 2 (Slow Path): Hugging Face Inference API for content analysis
    
    If content is unsafe:
    - Automatically creates a blocklist rule for the domain
    - Returns safe=false with action="blocked"
    
    If content is safe:
    - Returns safe=true with action="none"
    
    Error handling (fail-open):
    - If AI analysis fails, returns safe=true
    """
    try:
        # Truncate text content to 1000 chars to save bandwidth
        text_content = request.text_content[:1000] if request.text_content else ""
        
        # Run classification
        result = await classifier.predict(request.url, text_content)
        
        if not result["safe"]:
            # Content is unsafe - create blocklist rule
            domain = extract_domain(request.url)
            
            if domain:
                try:
                    async with async_session() as session:
                        # Check if rule already exists for this domain
                        from sqlalchemy import select
                        existing = await session.execute(
                            select(child_rules).where(
                                child_rules.c.pattern == domain,
                                child_rules.c.rule_type == "blocklist",
                                child_rules.c.created_by == current_user["user_id"]
                            )
                        )
                        
                        if not existing.fetchone():
                            # Determine explanation based on what blocked it
                            if result["blocked_by"] == "url_keywords":
                                explanation = f"AI Auto-blocked: URL contains '{result['matched_keyword']}'"
                            else:
                                explanation = f"AI Auto-blocked: {result['category']} detected ({result['confidence']:.0%} confidence)"
                            
                            # Create blocklist rule
                            # Note: For parent accounts, we create rules for all their children
                            # For child accounts, this would need the parent to approve
                            if current_user["account_type"] == "parent":
                                # Get all children of this parent
                                from ..db import users
                                children_result = await session.execute(
                                    select(users.c.id).where(
                                        users.c.parent_id == current_user["user_id"],
                                        users.c.account_type == "child"
                                    )
                                )
                                children = children_result.fetchall()
                                
                                # Create rule for each child
                                for child in children:
                                    await session.execute(
                                        insert(child_rules).values(
                                            rule_type="blocklist",
                                            pattern=domain,
                                            category=result.get("category") or "ai_blocked",
                                            explanation=explanation,
                                            enabled=True,
                                            target_type="child",
                                            target_id=child.id,
                                            created_by=current_user["user_id"]
                                        )
                                    )
                                
                                await session.commit()
                                logger.info(f"[Analysis] Created blocklist rule for domain: {domain} for {len(children)} children")
                            else:
                                # Child account - just log the detection, parent needs to approve
                                logger.info(f"[Analysis] Unsafe content detected for child account: {domain}")
                                
                except Exception as db_error:
                    logger.error(f"[Analysis] Failed to create blocklist rule: {db_error}")
                    # Don't fail the request if rule creation fails
            
            return ContentAnalysisResponse(
                safe=False,
                action="blocked",
                blocked_by=result["blocked_by"],
                category=result.get("category"),
                confidence=result.get("confidence"),
                matched_keyword=result.get("matched_keyword")
            )
        
        # Content is safe
        return ContentAnalysisResponse(
            safe=True,
            action="none"
        )
        
    except Exception as e:
        # Fail-open: if analysis fails, allow the content
        logger.error(f"[Analysis] Content analysis failed, allowing (fail-open): {e}")
        return ContentAnalysisResponse(
            safe=True,
            action="none"
        )


@router.get("/health")
async def analysis_health():
    """Check if the analysis service is healthy."""
    from ..config import settings
    
    return {
        "status": "healthy",
        "classifier_enabled": bool(settings.HUGGINGFACE_API_KEY),
        "fast_path_keywords": len(classifier._tokenize_url("example.com"))  # Quick sanity check
    }

