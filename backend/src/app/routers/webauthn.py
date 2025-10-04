from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from typing import Optional, Dict, Any
from ..config import settings
import logging

router = APIRouter(prefix="/webauthn", tags=["webauthn"])
logger = logging.getLogger(__name__)

def require_bearer(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    token = authorization.split(" ", 1)[1].strip()
    if token not in settings.gc_api_tokens:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    return token

class WebAuthnOptions(BaseModel):
    challenge: str
    rp: Dict[str, str]
    user: Dict[str, Any]
    pubKeyCredParams: list
    timeout: int
    attestation: str

@router.post("/register/options")
async def register_options(_=Depends(require_bearer)):
    """
    Generate WebAuthn registration options (stub for Week 4).
    
    This endpoint will be fully implemented with platform authenticator support.
    """
    return {
        "status": "stub",
        "message": "WebAuthn registration coming soon",
        "available": False
    }

@router.post("/register/verify")
async def register_verify(_=Depends(require_bearer)):
    """
    Verify WebAuthn registration response (stub for Week 4).
    """
    return {
        "status": "stub",
        "message": "WebAuthn registration verification coming soon",
        "available": False
    }

@router.post("/assertion/options")
async def assertion_options(_=Depends(require_bearer)):
    """
    Generate WebAuthn assertion options for authentication (stub for Week 4).
    """
    return {
        "status": "stub",
        "message": "WebAuthn assertion coming soon",
        "available": False
    }

@router.post("/assertion/verify")
async def assertion_verify(_=Depends(require_bearer)):
    """
    Verify WebAuthn assertion response (stub for Week 4).
    """
    return {
        "status": "stub",
        "message": "WebAuthn assertion verification coming soon",
        "available": False
    }
