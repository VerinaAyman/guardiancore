"""Account management router for parent-child relationships and groups.

Handles:
- Child account creation/deletion by parent
- Group creation/deletion
- Adding/removing children from groups
- Rule management per child/group
- Import/export rules per child/group
"""

from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, Field
from typing import Optional, List
from ..db import async_session, users, groups, group_members, child_rules, user_gamification
from sqlalchemy import insert, select, delete, update
from ..routers.auth import get_current_user, generate_child_code
from passlib.hash import bcrypt
from datetime import datetime
import logging

router = APIRouter(prefix="/accounts", tags=["accounts"])
logger = logging.getLogger(__name__)


class ChildCreate(BaseModel):
    username: str = Field(min_length=2, max_length=50)


class ChildResponse(BaseModel):
    id: int
    username: str
    access_code: str
    created_at: datetime


class GroupCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    description: Optional[str] = None


class GroupResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    member_count: int
    created_at: datetime


class GroupMemberAdd(BaseModel):
    child_id: int


class ChildRuleCreate(BaseModel):
    rule_type: str = Field(pattern=r"^(allowlist|blocklist|time_window)$")
    pattern: str = Field(min_length=1, max_length=500)
    category: Optional[str] = Field(None, max_length=100)
    explanation: Optional[str] = Field(None, max_length=1000)
    enabled: bool = True
    target_type: str = Field(pattern=r"^(child|group)$")
    target_id: int


class ChildRuleResponse(BaseModel):
    id: int
    rule_type: str
    pattern: str
    category: Optional[str]
    explanation: Optional[str]
    enabled: bool
    target_type: str
    target_id: int
    created_at: datetime


class RuleExport(BaseModel):
    exported_at: datetime
    target_type: str
    target_id: int
    target_name: str
    count: int
    rules: List[ChildRuleResponse]


class ImportRuleItem(BaseModel):
    rule_type: str
    pattern: str
    category: Optional[str] = None
    explanation: Optional[str] = None
    enabled: Optional[bool] = True


class ProfileUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=2, max_length=50)


def require_parent(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependency to ensure current user is a parent."""
    if current_user["account_type"] != "parent":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only parent accounts can perform this action"
        )
    return current_user


# ========== Child Account Management ==========

@router.post("/children", response_model=ChildResponse, status_code=status.HTTP_201_CREATED)
async def create_child(data: ChildCreate, current_user: dict = Depends(require_parent)):
    """Create a new child account (parent only)."""
    try:
        async with async_session() as session:
            # Generate unique access code
            access_code = generate_child_code()
            
            # Check if code already exists (very unlikely)
            while True:
                existing = await session.execute(
                    select(users).where(users.c.access_code == access_code)
                )
                if not existing.fetchone():
                    break
                access_code = generate_child_code()
            
            # Create child user
            stmt = insert(users).values(
                account_type="child",
                username=data.username,
                access_code=access_code,
                parent_id=current_user["user_id"],
                profile_data={}
            ).returning(users)
            
            result = await session.execute(stmt)
            await session.commit()
            child = result.fetchone()
            
            # Initialize gamification for child
            await session.execute(
                insert(user_gamification).values(
                    user_id=child.id,
                    day_key=datetime.utcnow().strftime("%Y-%m-%d"),
                    xp=0,
                    level=1
                )
            )
            await session.commit()
            
            return ChildResponse(
                id=child.id,
                username=child.username,
                access_code=child.access_code,
                created_at=child.created_at
            )
            
    except Exception as e:
        logger.exception("Failed to create child account")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create child account"
        )


@router.get("/children", response_model=List[ChildResponse])
async def list_children(current_user: dict = Depends(require_parent)):
    """List all children belonging to the parent."""
    try:
        async with async_session() as session:
            result = await session.execute(
                select(users).where(
                    users.c.parent_id == current_user["user_id"],
                    users.c.account_type == "child"
                ).order_by(users.c.created_at.asc())
            )
            children = result.fetchall()
            
            return [
                ChildResponse(
                    id=child.id,
                    username=child.username,
                    access_code=child.access_code,
                    created_at=child.created_at
                )
                for child in children
            ]
            
    except Exception as e:
        logger.exception("Failed to list children")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list children"
        )


@router.delete("/children/{child_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_child(child_id: int, current_user: dict = Depends(require_parent)):
    """Delete a child account (parent only)."""
    try:
        async with async_session() as session:
            # Verify child belongs to this parent
            result = await session.execute(
                select(users).where(
                    users.c.id == child_id,
                    users.c.parent_id == current_user["user_id"],
                    users.c.account_type == "child"
                )
            )
            child = result.fetchone()
            
            if not child:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Child not found"
                )
            
            # Delete child's rules
            await session.execute(
                delete(child_rules).where(
                    child_rules.c.target_type == "child",
                    child_rules.c.target_id == child_id
                )
            )
            
            # Remove from groups
            await session.execute(
                delete(group_members).where(group_members.c.child_id == child_id)
            )
            
            # Delete gamification data
            await session.execute(
                delete(user_gamification).where(user_gamification.c.user_id == child_id)
            )
            
            # Delete child user
            await session.execute(
                delete(users).where(users.c.id == child_id)
            )
            
            await session.commit()
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to delete child")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete child"
        )


# ========== Group Management ==========

@router.post("/groups", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(data: GroupCreate, current_user: dict = Depends(require_parent)):
    """Create a new group (parent only)."""
    try:
        async with async_session() as session:
            stmt = insert(groups).values(
                parent_id=current_user["user_id"],
                name=data.name,
                description=data.description
            ).returning(groups)
            
            result = await session.execute(stmt)
            await session.commit()
            group = result.fetchone()
            
            return GroupResponse(
                id=group.id,
                name=group.name,
                description=group.description,
                member_count=0,
                created_at=group.created_at
            )
            
    except Exception as e:
        logger.exception("Failed to create group")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create group"
        )


@router.get("/groups", response_model=List[GroupResponse])
async def list_groups(current_user: dict = Depends(require_parent)):
    """List all groups belonging to the parent."""
    try:
        async with async_session() as session:
            result = await session.execute(
                select(groups).where(
                    groups.c.parent_id == current_user["user_id"]
                ).order_by(groups.c.created_at.asc())
            )
            group_list = result.fetchall()
            
            response = []
            for group in group_list:
                # Count members
                members_result = await session.execute(
                    select(group_members).where(group_members.c.group_id == group.id)
                )
                member_count = len(members_result.fetchall())
                
                response.append(
                    GroupResponse(
                        id=group.id,
                        name=group.name,
                        description=group.description,
                        member_count=member_count,
                        created_at=group.created_at
                    )
                )
            
            return response
            
    except Exception as e:
        logger.exception("Failed to list groups")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list groups"
        )


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(group_id: int, current_user: dict = Depends(require_parent)):
    """Delete a group (children remain, only group is removed)."""
    try:
        async with async_session() as session:
            # Verify group belongs to this parent
            result = await session.execute(
                select(groups).where(
                    groups.c.id == group_id,
                    groups.c.parent_id == current_user["user_id"]
                )
            )
            group = result.fetchone()
            
            if not group:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Group not found"
                )
            
            # Delete group rules
            await session.execute(
                delete(child_rules).where(
                    child_rules.c.target_type == "group",
                    child_rules.c.target_id == group_id
                )
            )
            
            # Remove all members
            await session.execute(
                delete(group_members).where(group_members.c.group_id == group_id)
            )
            
            # Delete group
            await session.execute(
                delete(groups).where(groups.c.id == group_id)
            )
            
            await session.commit()
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to delete group")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete group"
        )


@router.post("/groups/{group_id}/members", status_code=status.HTTP_201_CREATED)
async def add_child_to_group(
    group_id: int,
    data: GroupMemberAdd,
    current_user: dict = Depends(require_parent)
):
    """Add a child to a group."""
    try:
        async with async_session() as session:
            # Verify group belongs to this parent
            group_result = await session.execute(
                select(groups).where(
                    groups.c.id == group_id,
                    groups.c.parent_id == current_user["user_id"]
                )
            )
            if not group_result.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Group not found"
                )
            
            # Verify child belongs to this parent
            child_result = await session.execute(
                select(users).where(
                    users.c.id == data.child_id,
                    users.c.parent_id == current_user["user_id"],
                    users.c.account_type == "child"
                )
            )
            if not child_result.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Child not found"
                )
            
            # Check if already a member
            existing = await session.execute(
                select(group_members).where(
                    group_members.c.group_id == group_id,
                    group_members.c.child_id == data.child_id
                )
            )
            if existing.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Child already in group"
                )
            
            # Add member
            await session.execute(
                insert(group_members).values(
                    group_id=group_id,
                    child_id=data.child_id
                )
            )
            await session.commit()
            
            return {"message": "Child added to group"}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to add child to group")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to add child to group"
        )


@router.delete("/groups/{group_id}/members/{child_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_child_from_group(
    group_id: int,
    child_id: int,
    current_user: dict = Depends(require_parent)
):
    """Remove a child from a group."""
    try:
        async with async_session() as session:
            # Verify group belongs to this parent
            group_result = await session.execute(
                select(groups).where(
                    groups.c.id == group_id,
                    groups.c.parent_id == current_user["user_id"]
                )
            )
            if not group_result.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Group not found"
                )
            
            # Remove member
            await session.execute(
                delete(group_members).where(
                    group_members.c.group_id == group_id,
                    group_members.c.child_id == child_id
                )
            )
            await session.commit()
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to remove child from group")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove child from group"
        )


@router.get("/groups/{group_id}/members", response_model=List[ChildResponse])
async def list_group_members(group_id: int, current_user: dict = Depends(require_parent)):
    """List all children in a group."""
    try:
        async with async_session() as session:
            # Verify group belongs to this parent
            group_result = await session.execute(
                select(groups).where(
                    groups.c.id == group_id,
                    groups.c.parent_id == current_user["user_id"]
                )
            )
            if not group_result.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Group not found"
                )
            
            # Get members
            result = await session.execute(
                select(users).join(
                    group_members,
                    group_members.c.child_id == users.c.id
                ).where(group_members.c.group_id == group_id)
            )
            members = result.fetchall()
            
            return [
                ChildResponse(
                    id=member.id,
                    username=member.username,
                    access_code=member.access_code,
                    created_at=member.created_at
                )
                for member in members
            ]
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to list group members")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list group members"
        )


# ========== Child/Group Rule Management ==========

@router.post("/rules", response_model=ChildRuleResponse, status_code=status.HTTP_201_CREATED)
async def create_child_rule(data: ChildRuleCreate, current_user: dict = Depends(require_parent)):
    """Create a rule for a child or group."""
    try:
        async with async_session() as session:
            # Verify target belongs to this parent
            if data.target_type == "child":
                target_result = await session.execute(
                    select(users).where(
                        users.c.id == data.target_id,
                        users.c.parent_id == current_user["user_id"],
                        users.c.account_type == "child"
                    )
                )
            else:  # group
                target_result = await session.execute(
                    select(groups).where(
                        groups.c.id == data.target_id,
                        groups.c.parent_id == current_user["user_id"]
                    )
                )
            
            if not target_result.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"{data.target_type.capitalize()} not found"
                )
            
            # Create rule
            stmt = insert(child_rules).values(
                rule_type=data.rule_type,
                pattern=data.pattern,
                category=data.category,
                explanation=data.explanation,
                enabled=data.enabled,
                target_type=data.target_type,
                target_id=data.target_id,
                created_by=current_user["user_id"]
            ).returning(child_rules)
            
            result = await session.execute(stmt)
            await session.commit()
            rule = result.fetchone()
            
            return ChildRuleResponse(
                id=rule.id,
                rule_type=rule.rule_type,
                pattern=rule.pattern,
                category=rule.category,
                explanation=rule.explanation,
                enabled=rule.enabled,
                target_type=rule.target_type,
                target_id=rule.target_id,
                created_at=rule.created_at
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to create child rule")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create rule"
        )


@router.get("/rules/{target_type}/{target_id}", response_model=List[ChildRuleResponse])
async def list_child_rules(
    target_type: str,
    target_id: int,
    current_user: dict = Depends(get_current_user)
):
    """List all rules for a child or group. Parents can view any child's rules. Children can only view their own."""
    try:
        if target_type not in ["child", "group"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid target type"
            )
        
        async with async_session() as session:
            # Verify ownership
            if target_type == "child":
                # Child accounts can only access their own rules
                if current_user["account_type"] == "child":
                    if current_user["user_id"] != target_id:
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="Children can only access their own rules"
                        )
                # Parent accounts can access any child's rules that belong to them
                elif current_user["account_type"] == "parent":
                    target_result = await session.execute(
                        select(users).where(
                            users.c.id == target_id,
                            users.c.parent_id == current_user["user_id"],
                            users.c.account_type == "child"
                        )
                    )
                    if not target_result.fetchone():
                        raise HTTPException(
                            status_code=status.HTTP_404_NOT_FOUND,
                            detail="Child not found"
                        )
            else:
                # Groups can only be accessed by parent
                if current_user["account_type"] != "parent":
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Only parents can access group rules"
                    )
                target_result = await session.execute(
                    select(groups).where(
                        groups.c.id == target_id,
                        groups.c.parent_id == current_user["user_id"]
                    )
                )
                if not target_result.fetchone():
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Group not found"
                    )
            
            # Get rules
            result = await session.execute(
                select(child_rules).where(
                    child_rules.c.target_type == target_type,
                    child_rules.c.target_id == target_id
                ).order_by(child_rules.c.created_at.desc())
            )
            rules = result.fetchall()
            
            return [
                ChildRuleResponse(
                    id=rule.id,
                    rule_type=rule.rule_type,
                    pattern=rule.pattern,
                    category=rule.category,
                    explanation=rule.explanation,
                    enabled=rule.enabled,
                    target_type=rule.target_type,
                    target_id=rule.target_id,
                    created_at=rule.created_at
                )
                for rule in rules
            ]
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to list child rules")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list rules"
        )


@router.get("/rules/combined/child/{child_id}", response_model=List[ChildRuleResponse])
async def get_combined_child_rules(child_id: int, current_user: dict = Depends(get_current_user)):
    """Get all rules that apply to a child (their direct rules + rules from groups they belong to)."""
    try:
        async with async_session() as session:
            # Verify access
            if current_user["account_type"] == "child":
                if current_user["user_id"] != child_id:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Children can only access their own rules"
                    )
            elif current_user["account_type"] == "parent":
                child_result = await session.execute(
                    select(users).where(
                        users.c.id == child_id,
                        users.c.parent_id == current_user["user_id"],
                        users.c.account_type == "child"
                    )
                )
                if not child_result.fetchone():
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Child not found"
                    )
            
            # Get direct child rules
            direct_rules_result = await session.execute(
                select(child_rules).where(
                    child_rules.c.target_type == "child",
                    child_rules.c.target_id == child_id
                )
            )
            direct_rules = direct_rules_result.fetchall()
            
            # Get groups the child belongs to
            groups_result = await session.execute(
                select(group_members.c.group_id).where(
                    group_members.c.child_id == child_id
                )
            )
            group_ids = [row.group_id for row in groups_result.fetchall()]
            
            # Get group rules
            group_rules = []
            if group_ids:
                group_rules_result = await session.execute(
                    select(child_rules).where(
                        child_rules.c.target_type == "group",
                        child_rules.c.target_id.in_(group_ids)
                    )
                )
                group_rules = group_rules_result.fetchall()
            
            # Combine and deduplicate rules (direct rules take precedence)
            all_rules = list(direct_rules) + list(group_rules)
            
            return [
                ChildRuleResponse(
                    id=rule.id,
                    rule_type=rule.rule_type,
                    pattern=rule.pattern,
                    category=rule.category,
                    explanation=rule.explanation,
                    enabled=rule.enabled,
                    target_type=rule.target_type,
                    target_id=rule.target_id,
                    created_at=rule.created_at
                )
                for rule in all_rules
            ]
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get combined child rules")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get combined rules"
        )


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_child_rule(rule_id: int, current_user: dict = Depends(require_parent)):
    """Delete a child/group rule."""
    try:
        async with async_session() as session:
            # Verify rule belongs to this parent
            result = await session.execute(
                select(child_rules).where(
                    child_rules.c.id == rule_id,
                    child_rules.c.created_by == current_user["user_id"]
                )
            )
            if not result.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Rule not found"
                )
            
            # Delete rule
            await session.execute(
                delete(child_rules).where(child_rules.c.id == rule_id)
            )
            await session.commit()
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to delete child rule")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete rule"
        )


@router.patch("/rules/{rule_id}", response_model=ChildRuleResponse)
async def update_child_rule(
    rule_id: int,
    enabled: bool,
    current_user: dict = Depends(require_parent)
):
    """Enable/disable a child/group rule."""
    try:
        async with async_session() as session:
            # Verify and update
            result = await session.execute(
                select(child_rules).where(
                    child_rules.c.id == rule_id,
                    child_rules.c.created_by == current_user["user_id"]
                )
            )
            rule = result.fetchone()
            
            if not rule:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Rule not found"
                )
            
            await session.execute(
                update(child_rules).where(
                    child_rules.c.id == rule_id
                ).values(enabled=enabled, updated_at=datetime.utcnow())
            )
            await session.commit()
            
            # Fetch updated rule
            result = await session.execute(
                select(child_rules).where(child_rules.c.id == rule_id)
            )
            updated_rule = result.fetchone()
            
            return ChildRuleResponse(
                id=updated_rule.id,
                rule_type=updated_rule.rule_type,
                pattern=updated_rule.pattern,
                category=updated_rule.category,
                explanation=updated_rule.explanation,
                enabled=updated_rule.enabled,
                target_type=updated_rule.target_type,
                target_id=updated_rule.target_id,
                created_at=updated_rule.created_at
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to update child rule")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update rule"
        )


# ========== Import/Export Rules ==========

@router.get("/rules/{target_type}/{target_id}/export", response_model=RuleExport)
async def export_child_rules(
    target_type: str,
    target_id: int,
    current_user: dict = Depends(require_parent)
):
    """Export rules for a child or group."""
    try:
        if target_type not in ["child", "group"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid target type"
            )
        
        async with async_session() as session:
            # Verify ownership and get name
            if target_type == "child":
                target_result = await session.execute(
                    select(users).where(
                        users.c.id == target_id,
                        users.c.parent_id == current_user["user_id"],
                        users.c.account_type == "child"
                    )
                )
                target = target_result.fetchone()
                target_name = target.username if target else "Unknown"
            else:
                target_result = await session.execute(
                    select(groups).where(
                        groups.c.id == target_id,
                        groups.c.parent_id == current_user["user_id"]
                    )
                )
                target = target_result.fetchone()
                target_name = target.name if target else "Unknown"
            
            if not target:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"{target_type.capitalize()} not found"
                )
            
            # Get rules
            result = await session.execute(
                select(child_rules).where(
                    child_rules.c.target_type == target_type,
                    child_rules.c.target_id == target_id
                ).order_by(child_rules.c.created_at.asc())
            )
            rules = result.fetchall()
            
            rules_list = [
                ChildRuleResponse(
                    id=rule.id,
                    rule_type=rule.rule_type,
                    pattern=rule.pattern,
                    category=rule.category,
                    explanation=rule.explanation,
                    enabled=rule.enabled,
                    target_type=rule.target_type,
                    target_id=rule.target_id,
                    created_at=rule.created_at
                )
                for rule in rules
            ]
            
            return RuleExport(
                exported_at=datetime.utcnow(),
                target_type=target_type,
                target_id=target_id,
                target_name=target_name,
                count=len(rules_list),
                rules=rules_list
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to export child rules")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to export rules"
        )


@router.post("/rules/{target_type}/{target_id}/import")
async def import_child_rules(
    target_type: str,
    target_id: int,
    rules: List[ImportRuleItem],
    current_user: dict = Depends(require_parent)
):
    """Import rules for a child or group."""
    try:
        if target_type not in ["child", "group"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid target type"
            )
        
        async with async_session() as session:
            # Verify ownership
            if target_type == "child":
                target_result = await session.execute(
                    select(users).where(
                        users.c.id == target_id,
                        users.c.parent_id == current_user["user_id"],
                        users.c.account_type == "child"
                    )
                )
            else:
                target_result = await session.execute(
                    select(groups).where(
                        groups.c.id == target_id,
                        groups.c.parent_id == current_user["user_id"]
                    )
                )
            
            if not target_result.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"{target_type.capitalize()} not found"
                )
            
            # Import rules
            imported = 0
            for rule_data in rules:
                await session.execute(
                    insert(child_rules).values(
                        rule_type=rule_data.rule_type,
                        pattern=rule_data.pattern,
                        category=rule_data.category,
                        explanation=rule_data.explanation,
                        enabled=rule_data.enabled if rule_data.enabled is not None else True,
                        target_type=target_type,
                        target_id=target_id,
                        created_by=current_user["user_id"]
                    )
                )
                imported += 1
            
            await session.commit()
            
            return {"imported_count": imported, "message": f"Imported {imported} rules"}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to import child rules")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to import rules"
        )


# ========== Profile Management ==========

@router.get("/profile")
async def get_profile(current_user: dict = Depends(get_current_user)):
    """Get current user's profile."""
    try:
        async with async_session() as session:
            result = await session.execute(
                select(users).where(users.c.id == current_user["user_id"])
            )
            user = result.fetchone()
            
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found"
                )
            
            profile = {
                "id": user.id,
                "username": user.username,
                "account_type": user.account_type,
                "created_at": user.created_at
            }
            
            if user.account_type == "parent":
                profile["email"] = user.email
            else:
                profile["access_code"] = user.access_code
                # Get parent info
                if user.parent_id:
                    parent_result = await session.execute(
                        select(users).where(users.c.id == user.parent_id)
                    )
                    parent = parent_result.fetchone()
                    if parent:
                        profile["parent_username"] = parent.username
            
            return profile
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get profile")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get profile"
        )


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=6)
    new_password: str = Field(min_length=6)


@router.patch("/profile")
async def update_profile(data: ProfileUpdate, current_user: dict = Depends(get_current_user)):
    """Update current user's profile."""
    try:
        async with async_session() as session:
            updates = {}
            if data.username:
                updates["username"] = data.username
            
            if updates:
                updates["updated_at"] = datetime.utcnow()
                await session.execute(
                    update(users).where(
                        users.c.id == current_user["user_id"]
                    ).values(**updates)
                )
                await session.commit()
            
            return {"message": "Profile updated successfully"}
            
    except Exception as e:
        logger.exception("Failed to update profile")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update profile"
        )


@router.post("/change-password")
async def change_password(data: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    """Change user's password (parent accounts only)."""
    # Only allow parents to change password (children use access codes)
    if current_user["account_type"] != "parent":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only parent accounts can change passwords"
        )
    
    try:
        async with async_session() as session:
            # Get user from database
            result = await session.execute(
                select(users).where(users.c.id == current_user["user_id"])
            )
            user = result.fetchone()
            
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found"
                )
            
            # Verify current password
            if not bcrypt.verify(data.current_password, user.password_hash):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Current password is incorrect"
                )
            
            # Hash new password
            new_hash = bcrypt.hash(data.new_password)
            
            # Update password
            await session.execute(
                update(users).where(
                    users.c.id == current_user["user_id"]
                ).values(
                    password_hash=new_hash,
                    updated_at=datetime.utcnow()
                )
            )
            await session.commit()
            
            return {"message": "Password changed successfully"}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to change password")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to change password"
        )
