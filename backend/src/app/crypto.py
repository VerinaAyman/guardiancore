"""Cryptographic utilities for encrypting sensitive data.

Handles encryption/decryption of PINs and recovery codes stored in profile_data.
Uses Fernet (symmetric encryption) with a key derived from the SECRET_KEY.
"""

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2
from cryptography.hazmat.backends import default_backend
import base64
import json
from typing import Any, List
from .config import settings


def _get_encryption_key() -> bytes:
    """Derive a Fernet key from the SECRET_KEY using PBKDF2."""
    # Use a fixed salt derived from app name (not ideal for production, but consistent)
    # In production, you'd want to store the salt securely
    salt = b'GuardianCore-Salt-v1'
    
    kdf = PBKDF2(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
        backend=default_backend()
    )
    
    key = base64.urlsafe_b64encode(kdf.derive(settings.SECRET_KEY.encode()))
    return key


_fernet = Fernet(_get_encryption_key())


def encrypt_value(value: Any) -> str:
    """Encrypt a value (string, list, dict) and return base64-encoded ciphertext.
    
    Args:
        value: The value to encrypt (will be JSON-serialized)
        
    Returns:
        Base64-encoded encrypted string
    """
    if value is None:
        return None
    
    # Serialize to JSON
    json_str = json.dumps(value)
    
    # Encrypt
    encrypted_bytes = _fernet.encrypt(json_str.encode('utf-8'))
    
    # Return as string
    return encrypted_bytes.decode('utf-8')


def decrypt_value(encrypted_str: str) -> Any:
    """Decrypt a base64-encoded ciphertext and return the original value.
    
    Args:
        encrypted_str: Base64-encoded encrypted string
        
    Returns:
        The decrypted value (deserialized from JSON)
    """
    if not encrypted_str:
        return None
    
    try:
        # Decrypt
        decrypted_bytes = _fernet.decrypt(encrypted_str.encode('utf-8'))
        
        # Deserialize from JSON
        json_str = decrypted_bytes.decode('utf-8')
        return json.loads(json_str)
    
    except Exception:
        # If decryption fails, return None (could be old unencrypted data)
        return None


def encrypt_pin(pin: str) -> str:
    """Encrypt a PIN for storage.
    
    Args:
        pin: The PIN string to encrypt
        
    Returns:
        Encrypted PIN string
    """
    return encrypt_value(pin)


def decrypt_pin(encrypted_pin: str) -> str:
    """Decrypt a stored PIN.
    
    Args:
        encrypted_pin: The encrypted PIN string
        
    Returns:
        Decrypted PIN string
    """
    return decrypt_value(encrypted_pin)


def encrypt_recovery_codes(codes: List[str]) -> str:
    """Encrypt recovery codes for storage.
    
    Args:
        codes: List of recovery code strings
        
    Returns:
        Encrypted recovery codes string
    """
    return encrypt_value(codes)


def decrypt_recovery_codes(encrypted_codes: str) -> List[str]:
    """Decrypt stored recovery codes.
    
    Args:
        encrypted_codes: The encrypted recovery codes string
        
    Returns:
        List of decrypted recovery code strings
    """
    result = decrypt_value(encrypted_codes)
    return result if isinstance(result, list) else []


def migrate_profile_data(profile_data: dict) -> dict:
    """Migrate profile_data from plaintext to encrypted format.
    
    This handles backwards compatibility by detecting plaintext values
    and encrypting them. If values are already encrypted, leaves them as-is.
    
    Args:
        profile_data: The profile_data dict (may have plaintext or encrypted values)
        
    Returns:
        Updated profile_data dict with encrypted values
    """
    if not profile_data:
        return profile_data
    
    updated = profile_data.copy()
    
    # Migrate PIN if it exists and appears to be plaintext
    if 'pin' in updated and updated['pin']:
        pin = updated['pin']
        # Check if it's plaintext (4-6 digits) vs encrypted (base64)
        if isinstance(pin, str) and pin.isdigit() and len(pin) <= 6:
            # Plaintext - encrypt it
            updated['pin'] = encrypt_pin(pin)
    
    # Migrate recovery codes if they exist and appear to be plaintext
    if 'recovery_codes' in updated and updated['recovery_codes']:
        codes = updated['recovery_codes']
        # Check if it's plaintext list vs encrypted string
        if isinstance(codes, list):
            # Plaintext - encrypt it
            updated['recovery_codes'] = encrypt_recovery_codes(codes)
    
    return updated
