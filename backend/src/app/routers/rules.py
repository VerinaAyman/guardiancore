from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, List
from ..db import async_session, rules
from sqlalchemy import insert, select, update, delete
from ..config import settings
from datetime import datetime
import logging

router = APIRouter(prefix="/rules", tags=["rules"])
logger = logging.getLogger(__name__)

class RuleCreate(BaseModel):
    rule_type: str = Field(pattern=r"^(allowlist|blocklist|time_window)$")
    pattern: str = Field(min_length=1, max_length=500)
    category: Optional[str] = Field(None, max_length=100)
    explanation: Optional[str] = Field(None, max_length=1000)
    enabled: bool = True

class RuleUpdate(BaseModel):
    pattern: Optional[str] = Field(None, min_length=1, max_length=500)
    category: Optional[str] = Field(None, max_length=100)
    explanation: Optional[str] = Field(None, max_length=1000)
    enabled: Optional[bool] = None

class RuleResponse(BaseModel):
    id: int
    rule_type: str
    pattern: str
    category: Optional[str]
    explanation: Optional[str]
    enabled: bool
    created_at: datetime
    updated_at: datetime

class RulesExport(BaseModel):
    exported_at: datetime
    count: int
    rules: List[RuleResponse]

class ImportRuleItem(BaseModel):
    rule_type: str
    pattern: str
    category: Optional[str] = None
    explanation: Optional[str] = None
    enabled: Optional[bool] = True

class ImportResponse(BaseModel):
    imported_count: int
    skipped: int
    details: List[str] = []

def require_bearer(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    token = authorization.split(" ", 1)[1].strip()
    if token not in settings.gc_api_tokens:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    return token

@router.get("/all/export", response_model=RulesExport)
async def export_rules(_=Depends(require_bearer)):
    """Export ALL rules (enabled and disabled). Placed before /{rule_id} to avoid 422 collisions."""
    try:
        async with async_session() as session:
            q = select(rules).order_by(rules.c.created_at.asc())
            result = await session.execute(q)
            rows = result.fetchall()
            data = [
                RuleResponse(
                    id=r.id,
                    rule_type=r.rule_type,
                    pattern=r.pattern,
                    category=r.category,
                    explanation=r.explanation,
                    enabled=r.enabled,
                    created_at=r.created_at,
                    updated_at=r.updated_at,
                ) for r in rows
            ]
            return RulesExport(
                exported_at=datetime.utcnow(),
                count=len(data),
                rules=data
            )
    except Exception:
        logger.exception("Failed to export rules")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to export rules")

@router.post("/all/import", response_model=ImportResponse)
async def import_rules(payload: dict, _=Depends(require_bearer)):
    """Import rules JSON previously exported. Accepts either {rules:[...]} or direct list."""
    try:
        # Normalize input
        raw_list = []
        if isinstance(payload, list):
            raw_list = payload
        elif isinstance(payload, dict):
            # Support two shapes: {"rules": [...]} or {"data": [...]} or { arbitrary }
            if isinstance(payload.get("rules"), list):
                raw_list = payload.get("rules")
            elif isinstance(payload.get("data"), list):
                raw_list = payload.get("data")
            else:
                # Maybe the dict itself is a single rule
                maybe_single = {k: payload.get(k) for k in ("rule_type", "pattern") if k in payload}
                if len(maybe_single) == 2:
                    raw_list = [payload]
        if not raw_list:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No rules found in payload")

        imported = 0
        skipped = 0
        details: List[str] = []
        async with async_session() as session:
            for idx, item in enumerate(raw_list):
                try:
                    data = ImportRuleItem(**item)
                except Exception as e:
                    skipped += 1
                    details.append(f"item {idx} invalid: {e}")
                    continue
                try:
                    stmt = insert(rules).values(
                        rule_type=data.rule_type,
                        pattern=data.pattern,
                        category=data.category,
                        explanation=data.explanation,
                        enabled=True if data.enabled is None else data.enabled,
                    )
                    await session.execute(stmt)
                    imported += 1
                except Exception as e:  # pragma: no cover - broad catch for robustness
                    skipped += 1
                    details.append(f"item {idx} failed: {e}")
            await session.commit()
        return ImportResponse(imported_count=imported, skipped=skipped, details=details)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to import rules")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to import rules")

@router.post("/", response_model=RuleResponse, status_code=status.HTTP_201_CREATED)
async def create_rule(rule: RuleCreate, _=Depends(require_bearer)):
    """Create a new parental control rule."""
    try:
        async with async_session() as session:
            stmt = insert(rules).values(
                rule_type=rule.rule_type,
                pattern=rule.pattern,
                category=rule.category,
                explanation=rule.explanation,
                enabled=rule.enabled,
            ).returning(rules)
            result = await session.execute(stmt)
            await session.commit()
            row = result.fetchone()
            return RuleResponse(
                id=row.id,
                rule_type=row.rule_type,
                pattern=row.pattern,
                category=row.category,
                explanation=row.explanation,
                enabled=row.enabled,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
    except Exception as e:
        logger.exception("Failed to create rule")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to create rule")

@router.get("/", response_model=List[RuleResponse])
async def list_rules(
    enabled_only: bool = True,
    rule_type: Optional[str] = None,
    _=Depends(require_bearer)
):
    """List all parental control rules."""
    try:
        async with async_session() as session:
            q = select(rules)
            if enabled_only:
                q = q.where(rules.c.enabled == True)
            if rule_type:
                q = q.where(rules.c.rule_type == rule_type)
            q = q.order_by(rules.c.created_at.desc())
            
            result = await session.execute(q)
            rows = result.fetchall()
            
            return [
                RuleResponse(
                    id=row.id,
                    rule_type=row.rule_type,
                    pattern=row.pattern,
                    category=row.category,
                    explanation=row.explanation,
                    enabled=row.enabled,
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                )
                for row in rows
            ]
    except Exception as e:
        logger.exception("Failed to list rules")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to list rules")

@router.get("/{rule_id}", response_model=RuleResponse)
async def get_rule(rule_id: int, _=Depends(require_bearer)):
    """Get a specific rule by ID."""
    try:
        async with async_session() as session:
            q = select(rules).where(rules.c.id == rule_id)
            result = await session.execute(q)
            row = result.fetchone()
            
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                    detail="Rule not found")
            
            return RuleResponse(
                id=row.id,
                rule_type=row.rule_type,
                pattern=row.pattern,
                category=row.category,
                explanation=row.explanation,
                enabled=row.enabled,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get rule")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to get rule")

@router.patch("/{rule_id}", response_model=RuleResponse)
async def update_rule(rule_id: int, updates: RuleUpdate, _=Depends(require_bearer)):
    """Update a parental control rule."""
    try:
        async with async_session() as session:
            # Build update dict with only provided fields
            update_dict = {}
            if updates.pattern is not None:
                update_dict["pattern"] = updates.pattern
            if updates.category is not None:
                update_dict["category"] = updates.category
            if updates.explanation is not None:
                update_dict["explanation"] = updates.explanation
            if updates.enabled is not None:
                update_dict["enabled"] = updates.enabled
            
            if not update_dict:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                    detail="No fields to update")
            
            update_dict["updated_at"] = datetime.utcnow()
            
            stmt = (
                update(rules)
                .where(rules.c.id == rule_id)
                .values(**update_dict)
                .returning(rules)
            )
            result = await session.execute(stmt)
            await session.commit()
            row = result.fetchone()
            
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                    detail="Rule not found")
            
            return RuleResponse(
                id=row.id,
                rule_type=row.rule_type,
                pattern=row.pattern,
                category=row.category,
                explanation=row.explanation,
                enabled=row.enabled,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to update rule")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to update rule")

@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(rule_id: int, _=Depends(require_bearer)):
    """Delete a parental control rule."""
    try:
        async with async_session() as session:
            stmt = delete(rules).where(rules.c.id == rule_id)
            result = await session.execute(stmt)
            await session.commit()
            
            if result.rowcount == 0:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                    detail="Rule not found")
            
            return None
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to delete rule")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to delete rule")
