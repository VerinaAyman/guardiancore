"""Content Analysis Router for intelligent content classification.

Provides endpoints for:
- POST /analyze/content - Analyze URL and page content for safety
"""

from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, Field
from typing import Optional
from urllib.parse import urlparse
from sqlalchemy import insert, select
from datetime import datetime
import logging

from ..services.classifier import classifier
from ..db import async_session, child_rules, users
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
    rule_created: bool = False  # Whether a new blocklist rule was created
    domain: Optional[str] = None  # The domain that was blocked


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
    - Automatically creates a PERSISTENT blocklist rule for the domain
    - Returns safe=false with action="blocked" and rule_created=true
    
    If content is safe:
    - Returns safe=true with action="none"
    
    Error handling (fail-open):
    - If AI analysis fails, returns safe=true
    """
    rule_created = False
    blocked_domain = None
    
    try:
        # Truncate text content to 1000 chars to save bandwidth
        text_content = request.text_content[:1000] if request.text_content else ""
        
        # Run classification
        result = await classifier.predict(request.url, text_content)
        
        if not result["safe"]:
            # Content is unsafe - create persistent blocklist rule
            domain = extract_domain(request.url)
            blocked_domain = domain
            
            if domain:
                try:
                    async with async_session() as session:
                        # Determine explanation based on what blocked it
                        if result["blocked_by"] == "url_keywords":
                            explanation = f"Auto-blocked by AI Safety Detection: URL contains '{result['matched_keyword']}'"
                        else:
                            conf = result.get('confidence', 0)
                            explanation = f"Auto-blocked by AI Safety Detection: {result.get('category', 'unsafe')} detected ({conf:.0%} confidence)"
                        
                        category = result.get("category") or "unsafe_content"
                        
                        if current_user["account_type"] == "child":
                            # CHILD ACCOUNT: Create rule targeting this specific child
                            # First, get the child's parent_id
                            child_result = await session.execute(
                                select(users.c.parent_id).where(users.c.id == current_user["user_id"])
                            )
                            child_row = child_result.fetchone()
                            
                            if child_row and child_row.parent_id:
                                parent_id = child_row.parent_id
                                
                                # Check if rule already exists for this child
                                existing = await session.execute(
                                    select(child_rules).where(
                                        child_rules.c.pattern == domain,
                                        child_rules.c.rule_type == "blocklist",
                                        child_rules.c.target_type == "child",
                                        child_rules.c.target_id == current_user["user_id"]
                                    )
                                )
                                
                                if not existing.fetchone():
                                    # Insert new blocklist rule for this child
                                    await session.execute(
                                        insert(child_rules).values(
                                            rule_type="blocklist",
                                            pattern=domain,
                                            category=category,
                                            explanation=explanation,
                                            enabled=True,
                                            target_type="child",
                                            target_id=current_user["user_id"],
                                            created_by=parent_id  # Created on behalf of parent
                                        )
                                    )
                                    await session.commit()
                                    rule_created = True
                                    logger.info(f"[Analysis] ✅ Created blocklist rule for domain '{domain}' targeting child {current_user['user_id']}")
                                else:
                                    logger.info(f"[Analysis] Rule for '{domain}' already exists for child {current_user['user_id']}")
                            else:
                                logger.warning(f"[Analysis] Child {current_user['user_id']} has no parent_id, cannot create rule")
                        
                        else:
                            # PARENT ACCOUNT: Create rules for ALL their children
                            children_result = await session.execute(
                                select(users.c.id).where(
                                    users.c.parent_id == current_user["user_id"],
                                    users.c.account_type == "child"
                                )
                            )
                            children = children_result.fetchall()
                            
                            rules_created_count = 0
                            for child in children:
                                # Check if rule already exists for this child
                                existing = await session.execute(
                                    select(child_rules).where(
                                        child_rules.c.pattern == domain,
                                        child_rules.c.rule_type == "blocklist",
                                        child_rules.c.target_type == "child",
                                        child_rules.c.target_id == child.id
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
                                            target_id=child.id,
                                            created_by=current_user["user_id"]
                                        )
                                    )
                                    rules_created_count += 1
                            
                            if rules_created_count > 0:
                                await session.commit()
                                rule_created = True
                                logger.info(f"[Analysis] ✅ Created blocklist rule for domain '{domain}' for {rules_created_count} children")
                            else:
                                logger.info(f"[Analysis] Rules for '{domain}' already exist for all children")
                                
                except Exception as db_error:
                    logger.error(f"[Analysis] Failed to create blocklist rule: {db_error}")
                    # Don't fail the request if rule creation fails
            
            return ContentAnalysisResponse(
                safe=False,
                action="blocked",
                blocked_by=result["blocked_by"],
                category=result.get("category"),
                confidence=result.get("confidence"),
                matched_keyword=result.get("matched_keyword"),
                rule_created=rule_created,
                domain=blocked_domain
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

