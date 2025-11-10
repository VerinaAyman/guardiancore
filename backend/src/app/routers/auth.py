"""Authentication router for parent and child account management.

Handles:
- Parent registration (email + password)
- Parent login (email + password) -> JWT
- Child login (6-digit code) -> JWT
- Token verification
"""

from fastapi import APIRouter, HTTPException, status, Depends, Header
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from ..db import async_session, users, user_gamification
from ..config import settings
from sqlalchemy import insert, select, func
from passlib.hash import bcrypt
import jwt
from datetime import datetime, timedelta
import secrets
import logging
from ..crypto import encrypt_pin, decrypt_pin, encrypt_recovery_codes, decrypt_recovery_codes

router = APIRouter(prefix="/auth", tags=["authentication"])
logger = logging.getLogger(__name__)

# JWT configuration
JWT_SECRET = settings.SECRET_KEY
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days


class ParentRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=100)
    username: str = Field(min_length=2, max_length=50)


class ParentLogin(BaseModel):
    email: EmailStr
    password: str


class ChildLogin(BaseModel):
    access_code: str = Field(min_length=6, max_length=6)


class RecoveryReset(BaseModel):
    email: EmailStr
    recovery_code: str = Field(min_length=1, max_length=20)
    new_password: str = Field(min_length=8, max_length=100)
    new_pin: str = Field(min_length=4, max_length=6, pattern=r'^\d{4,6}$')


class PasswordOnlyReset(BaseModel):
    email: EmailStr
    recovery_code: str = Field(min_length=1, max_length=20)
    new_password: str = Field(min_length=8, max_length=100)


class PINOnlyReset(BaseModel):
    email: EmailStr
    recovery_code: str = Field(min_length=1, max_length=20)
    new_pin: str = Field(min_length=4, max_length=6, pattern=r'^\d{4,6}$')


class AuthResponse(BaseModel):
    token: str
    user_id: int
    account_type: str
    username: str
    email: Optional[str] = None


class TokenVerify(BaseModel):
    user_id: int
    account_type: str
    username: str
    email: Optional[str] = None


def create_jwt_token(user_id: int, account_type: str) -> str:
    """Create JWT token for authenticated user."""
    payload = {
        "user_id": user_id,
        "account_type": account_type,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_jwt_token(token: str) -> dict:
    """Verify JWT token and return payload."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def get_current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    """Dependency to get current authenticated user from token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid authorization header")
    
    token = authorization.split(" ", 1)[1].strip()
    return verify_jwt_token(token)


def generate_child_code() -> str:
    """Generate a unique 6-digit access code for child accounts."""
    return ''.join([str(secrets.randbelow(10)) for _ in range(6)])


@router.post("/parent/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register_parent(data: ParentRegister):
    """Register a new parent account."""
    try:
        async with async_session() as session:
            # Normalize email to lowercase
            email_lower = data.email.lower().strip()
            
            # Check if email already exists
            existing = await session.execute(
                select(users).where(func.lower(users.c.email) == email_lower)
            )
            if existing.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already registered"
                )
            
            # Hash password
            password_hash = bcrypt.hash(data.password)
            
            # Create parent user
            stmt = insert(users).values(
                email=email_lower,
                password_hash=password_hash,
                account_type="parent",
                username=data.username,
                profile_data={}
            ).returning(users)
            
            result = await session.execute(stmt)
            await session.commit()
            user = result.fetchone()
            
            # Initialize gamification for parent
            await session.execute(
                insert(user_gamification).values(
                    user_id=user.id,
                    day_key=datetime.utcnow().strftime("%Y-%m-%d"),
                    xp=0,
                    level=1
                )
            )
            await session.commit()
            
            # Generate JWT token
            token = create_jwt_token(user.id, "parent")
            
            return AuthResponse(
                token=token,
                user_id=user.id,
                account_type="parent",
                username=user.username,
                email=user.email
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to register parent")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to register user"
        )


@router.post("/parent/login", response_model=AuthResponse)
async def login_parent(data: ParentLogin):
    """Login with parent credentials."""
    try:
        async with async_session() as session:
            # Normalize email to lowercase for case-insensitive lookup
            email_lower = data.email.lower().strip()
            
            # Find user by email
            result = await session.execute(
                select(users).where(
                    func.lower(users.c.email) == email_lower,
                    users.c.account_type == "parent"
                )
            )
            user = result.fetchone()
            
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password"
                )
            
            # Verify password
            if not bcrypt.verify(data.password, user.password_hash):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password"
                )
            
            # Generate JWT token
            token = create_jwt_token(user.id, "parent")
            
            return AuthResponse(
                token=token,
                user_id=user.id,
                account_type="parent",
                username=user.username,
                email=user.email
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to login parent")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to login"
        )


@router.post("/child/login", response_model=AuthResponse)
async def login_child(data: ChildLogin):
    """Login with child access code."""
    try:
        async with async_session() as session:
            # Find child by access code
            result = await session.execute(
                select(users).where(
                    users.c.access_code == data.access_code,
                    users.c.account_type == "child"
                )
            )
            user = result.fetchone()
            
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid access code"
                )
            
            # Generate JWT token
            token = create_jwt_token(user.id, "child")
            
            return AuthResponse(
                token=token,
                user_id=user.id,
                account_type="child",
                username=user.username,
                email=None
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to login child")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to login"
        )


@router.post("/verify", response_model=TokenVerify)
async def verify_token(current_user: dict = Depends(get_current_user)):
    """Verify JWT token and return user info."""
    try:
        async with async_session() as session:
            result = await session.execute(
                select(users).where(users.c.id == current_user["user_id"])
            )
            user = result.fetchone()
            
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not found"
                )
            
            return TokenVerify(
                user_id=user.id,
                account_type=user.account_type,
                username=user.username,
                email=user.email if user.account_type == "parent" else None
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to verify token")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify token"
        )


@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    """Logout (client should discard token)."""
    # JWT tokens are stateless, so we just acknowledge the logout
    # Client should remove the token from storage
    return {"message": "Logged out successfully"}


@router.post("/reset-with-recovery")
async def reset_with_recovery_code(data: RecoveryReset):
    """Reset password and PIN using a recovery code."""
    try:
        async with async_session() as session:
            # Find user by email
            result = await session.execute(
                select(users).where(
                    users.c.email == data.email,
                    users.c.account_type == "parent"
                )
            )
            user = result.fetchone()
            
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found"
                )
            
            # Get recovery codes from profile_data and decrypt them
            profile_data = user.profile_data or {}
            encrypted_codes = profile_data.get('recovery_codes', [])
            
            if not encrypted_codes:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No recovery codes found for this account"
                )
            
            # Decrypt recovery codes
            recovery_codes = decrypt_recovery_codes(encrypted_codes)
            
            # Check if recovery code is valid
            if data.recovery_code.upper() not in [code.upper() for code in recovery_codes]:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid recovery code"
                )
            
            # Hash new password
            new_password_hash = bcrypt.hash(data.new_password)
            
            # Remove used recovery code
            recovery_codes = [code for code in recovery_codes if code.upper() != data.recovery_code.upper()]
            
            # Update profile_data with new PIN and remaining recovery codes (encrypted)
            updated_profile_data = profile_data.copy()
            updated_profile_data['pin'] = encrypt_pin(data.new_pin)
            updated_profile_data['recovery_codes'] = encrypt_recovery_codes(recovery_codes)
            
            # Update user password and profile_data
            from sqlalchemy import update
            await session.execute(
                update(users).where(
                    users.c.id == user.id
                ).values(
                    password_hash=new_password_hash,
                    profile_data=updated_profile_data
                )
            )
            await session.commit()
            
            logger.info(f"Password and PIN reset for user {user.id} using recovery code")
            
            return {
                "message": "Password and PIN reset successfully",
                "remaining_codes": len(recovery_codes)
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to reset with recovery code")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset password and PIN"
        )


@router.post("/reset-password-only")
async def reset_password_only(data: PasswordOnlyReset):
    """Reset password only using a recovery code (PIN unchanged)."""
    try:
        async with async_session() as session:
            # Find user by email
            result = await session.execute(
                select(users).where(
                    users.c.email == data.email,
                    users.c.account_type == "parent"
                )
            )
            user = result.fetchone()
            
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found"
                )
            
            # Get recovery codes from profile_data and decrypt them
            profile_data = user.profile_data or {}
            encrypted_codes = profile_data.get('recovery_codes', [])
            
            if not encrypted_codes:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No recovery codes found for this account"
                )
            
            # Decrypt recovery codes
            recovery_codes = decrypt_recovery_codes(encrypted_codes)
            
            # Check if recovery code is valid
            if data.recovery_code.upper() not in [code.upper() for code in recovery_codes]:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid recovery code"
                )
            
            # Hash new password
            new_password_hash = bcrypt.hash(data.new_password)
            
            # Remove used recovery code
            recovery_codes = [code for code in recovery_codes if code.upper() != data.recovery_code.upper()]
            
            # Update profile_data with remaining recovery codes (PIN unchanged, encrypt codes)
            updated_profile_data = profile_data.copy()
            updated_profile_data['recovery_codes'] = encrypt_recovery_codes(recovery_codes)
            
            # Update user password and profile_data
            from sqlalchemy import update
            await session.execute(
                update(users).where(
                    users.c.id == user.id
                ).values(
                    password_hash=new_password_hash,
                    profile_data=updated_profile_data
                )
            )
            await session.commit()
            
            logger.info(f"Password reset for user {user.id} using recovery code (PIN unchanged)")
            
            return {
                "message": "Password reset successfully",
                "remaining_codes": len(recovery_codes)
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to reset password")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset password"
        )


@router.post("/reset-pin-only")
async def reset_pin_only(data: PINOnlyReset):
    """Reset PIN only using a recovery code (password unchanged)."""
    try:
        async with async_session() as session:
            # Find user by email
            result = await session.execute(
                select(users).where(
                    users.c.email == data.email,
                    users.c.account_type == "parent"
                )
            )
            user = result.fetchone()
            
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found"
                )
            
            # Get recovery codes from profile_data and decrypt them
            profile_data = user.profile_data or {}
            encrypted_codes = profile_data.get('recovery_codes', [])
            
            if not encrypted_codes:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No recovery codes found for this account"
                )
            
            # Decrypt recovery codes
            recovery_codes = decrypt_recovery_codes(encrypted_codes)
            
            # Check if recovery code is valid
            if data.recovery_code.upper() not in [code.upper() for code in recovery_codes]:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid recovery code"
                )
            
            # Remove used recovery code
            recovery_codes = [code for code in recovery_codes if code.upper() != data.recovery_code.upper()]
            
            # Update profile_data with new PIN and remaining recovery codes (encrypted)
            updated_profile_data = profile_data.copy()
            updated_profile_data['pin'] = encrypt_pin(data.new_pin)
            updated_profile_data['recovery_codes'] = encrypt_recovery_codes(recovery_codes)
            
            # Update user profile_data (password unchanged)
            from sqlalchemy import update
            await session.execute(
                update(users).where(
                    users.c.id == user.id
                ).values(
                    profile_data=updated_profile_data
                )
            )
            await session.commit()
            
            logger.info(f"PIN reset for user {user.id} using recovery code (password unchanged)")
            
            return {
                "message": "PIN reset successfully",
                "remaining_codes": len(recovery_codes)
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to reset PIN")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset PIN"
        )
