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
from sqlalchemy import insert, select, update, func
from passlib.hash import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
import secrets
import logging
from ..crypto import encrypt_pin, decrypt_pin, encrypt_recovery_codes, decrypt_recovery_codes

router = APIRouter(prefix="/auth", tags=["authentication"])
logger = logging.getLogger(__name__)

# JWT configuration
JWT_SECRET          = settings.SECRET_KEY
JWT_ALGORITHM       = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days


# ─── Pydantic models ──────────────────────────────────────────────────────────

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
    recovery_code: str  = Field(min_length=1, max_length=20)
    new_password: str   = Field(min_length=8, max_length=100)
    new_pin: str        = Field(min_length=4, max_length=6, pattern=r'^\d{4,6}$')


class PasswordOnlyReset(BaseModel):
    email: EmailStr
    recovery_code: str = Field(min_length=1, max_length=20)
    new_password: str  = Field(min_length=8, max_length=100)


class PINOnlyReset(BaseModel):
    email: EmailStr
    recovery_code: str = Field(min_length=1, max_length=20)
    new_pin: str       = Field(min_length=4, max_length=6, pattern=r'^\d{4,6}$')


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


# ─── JWT helpers ──────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    """Return timezone-aware UTC datetime (avoids DeprecationWarning in Python 3.12+)."""
    return datetime.now(tz=timezone.utc)


def create_jwt_token(user_id: int, account_type: str) -> str:
    """Create JWT token for authenticated user."""
    now = _utcnow()
    payload = {
        "user_id":      user_id,
        "account_type": account_type,
        "exp":          now + timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat":          now,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_jwt_token(token: str) -> dict:
    """Verify JWT token and return payload."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def get_current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    """Dependency: extract and verify the Bearer token from the Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
        )
    token = authorization.split(" ", 1)[1].strip()
    return verify_jwt_token(token)


def generate_child_code() -> str:
    """Generate a unique 6-digit access code for child accounts."""
    return "".join(str(secrets.randbelow(10)) for _ in range(6))


# ─── recovery-code helpers ────────────────────────────────────────────────────

def _validate_recovery_code(profile_data: dict, submitted_code: str) -> list[str]:
    """
    Decrypt stored recovery codes, verify the submitted one, and return the
    remaining codes (with the used one removed).

    Raises HTTPException on failure.
    """
    encrypted_codes = profile_data.get("recovery_codes", [])
    if not encrypted_codes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No recovery codes found for this account",
        )

    recovery_codes = decrypt_recovery_codes(encrypted_codes)
    upper_codes    = [c.upper() for c in recovery_codes]

    if submitted_code.upper() not in upper_codes:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid recovery code",
        )

    # Remove the used code
    return [c for c in recovery_codes if c.upper() != submitted_code.upper()]


# ─── routes ───────────────────────────────────────────────────────────────────

@router.post("/parent/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register_parent(data: ParentRegister):
    """Register a new parent account."""
    try:
        async with async_session() as session:
            email_lower = data.email.lower().strip()

            existing = await session.execute(
                select(users).where(func.lower(users.c.email) == email_lower)
            )
            if existing.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already registered",
                )

            password_hash = bcrypt.hash(data.password)

            stmt = insert(users).values(
                email=email_lower,
                password_hash=password_hash,
                account_type="parent",
                username=data.username,
                profile_data={},
            ).returning(users)

            result = await session.execute(stmt)
            await session.commit()
            user = result.fetchone()

            # Initialize gamification row — non-fatal if it fails
            try:
                await session.execute(
                    insert(user_gamification).values(
                        user_id=user.id,
                        day_key=_utcnow().strftime("%Y-%m-%d"),
                        xp=0,
                        level=1,
                    )
                )
                await session.commit()
            except Exception:
                logger.warning("Could not initialize gamification for user %s", user.id)

            token = create_jwt_token(user.id, "parent")
            return AuthResponse(
                token=token,
                user_id=user.id,
                account_type="parent",
                username=user.username,
                email=user.email,
            )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to register parent")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to register user",
        )


@router.post("/parent/login", response_model=AuthResponse)
async def login_parent(data: ParentLogin):
    """Login with parent credentials."""
    try:
        async with async_session() as session:
            email_lower = data.email.lower().strip()

            result = await session.execute(
                select(users).where(
                    func.lower(users.c.email) == email_lower,
                    users.c.account_type == "parent",
                )
            )
            user = result.fetchone()

            # Deliberate: same error message for unknown email and wrong password
            if not user or not bcrypt.verify(data.password, user.password_hash):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password",
                )

            token = create_jwt_token(user.id, "parent")
            return AuthResponse(
                token=token,
                user_id=user.id,
                account_type="parent",
                username=user.username,
                email=user.email,
            )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to login parent")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to login",
        )


@router.post("/child/login", response_model=AuthResponse)
async def login_child(data: ChildLogin):
    """Login with child access code."""
    try:
        async with async_session() as session:
            result = await session.execute(
                select(users).where(
                    users.c.access_code == data.access_code,
                    users.c.account_type == "child",
                )
            )
            user = result.fetchone()

            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid access code",
                )

            token = create_jwt_token(user.id, "child")
            return AuthResponse(
                token=token,
                user_id=user.id,
                account_type="child",
                username=user.username,
                email=None,
            )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to login child")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to login",
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
                    detail="User not found",
                )

            return TokenVerify(
                user_id=user.id,
                account_type=user.account_type,
                username=user.username,
                email=user.email if user.account_type == "parent" else None,
            )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to verify token")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify token",
        )


@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    """Logout (client should discard token). JWT is stateless."""
    return {"message": "Logged out successfully"}


@router.post("/reset-with-recovery")
async def reset_with_recovery_code(data: RecoveryReset):
    """Reset both password and PIN using a recovery code."""
    try:
        async with async_session() as session:
            result = await session.execute(
                select(users).where(
                    users.c.email == data.email,
                    users.c.account_type == "parent",
                )
            )
            user = result.fetchone()
            if not user:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

            profile_data   = user.profile_data or {}
            remaining_codes = _validate_recovery_code(profile_data, data.recovery_code)

            updated_profile = {
                **profile_data,
                "pin":            encrypt_pin(data.new_pin),
                "recovery_codes": encrypt_recovery_codes(remaining_codes),
            }

            await session.execute(
                update(users)
                .where(users.c.id == user.id)
                .values(
                    password_hash=bcrypt.hash(data.new_password),
                    profile_data=updated_profile,
                )
            )
            await session.commit()
            logger.info("Password + PIN reset for user %s via recovery code", user.id)

            return {"message": "Password and PIN reset successfully", "remaining_codes": len(remaining_codes)}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to reset with recovery code")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset password and PIN",
        )


@router.post("/reset-password-only")
async def reset_password_only(data: PasswordOnlyReset):
    """Reset password only using a recovery code (PIN unchanged)."""
    try:
        async with async_session() as session:
            result = await session.execute(
                select(users).where(
                    users.c.email == data.email,
                    users.c.account_type == "parent",
                )
            )
            user = result.fetchone()
            if not user:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

            profile_data    = user.profile_data or {}
            remaining_codes = _validate_recovery_code(profile_data, data.recovery_code)

            updated_profile = {
                **profile_data,
                "recovery_codes": encrypt_recovery_codes(remaining_codes),
            }

            await session.execute(
                update(users)
                .where(users.c.id == user.id)
                .values(
                    password_hash=bcrypt.hash(data.new_password),
                    profile_data=updated_profile,
                )
            )
            await session.commit()
            logger.info("Password reset for user %s via recovery code (PIN unchanged)", user.id)

            return {"message": "Password reset successfully", "remaining_codes": len(remaining_codes)}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to reset password")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset password",
        )


@router.post("/reset-pin-only")
async def reset_pin_only(data: PINOnlyReset):
    """Reset PIN only using a recovery code (password unchanged)."""
    try:
        async with async_session() as session:
            result = await session.execute(
                select(users).where(
                    users.c.email == data.email,
                    users.c.account_type == "parent",
                )
            )
            user = result.fetchone()
            if not user:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

            profile_data    = user.profile_data or {}
            remaining_codes = _validate_recovery_code(profile_data, data.recovery_code)

            updated_profile = {
                **profile_data,
                "pin":            encrypt_pin(data.new_pin),
                "recovery_codes": encrypt_recovery_codes(remaining_codes),
            }

            await session.execute(
                update(users)
                .where(users.c.id == user.id)
                .values(profile_data=updated_profile)
            )
            await session.commit()
            logger.info("PIN reset for user %s via recovery code (password unchanged)", user.id)

            return {"message": "PIN reset successfully", "remaining_codes": len(remaining_codes)}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to reset PIN")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset PIN",
        )