"""Migration script to encrypt existing plaintext PINs and recovery codes.

Run this once after deploying the encryption changes to encrypt all existing data.

Usage:
    python -m src.app.migrate_encrypt_profile_data
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.app.db import async_session, users
from src.app.crypto import encrypt_pin, encrypt_recovery_codes, migrate_profile_data
from sqlalchemy import select, update
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def migrate_all_profile_data():
    """Migrate all users' profile_data to use encrypted PINs and recovery codes."""
    
    logger.info("Starting profile_data encryption migration...")
    
    async with async_session() as session:
        # Get all users with profile_data
        result = await session.execute(
            select(users).where(users.c.profile_data.isnot(None))
        )
        all_users = result.fetchall()
        
        logger.info(f"Found {len(all_users)} users with profile_data")
        
        updated_count = 0
        
        for user in all_users:
            try:
                profile_data = user.profile_data or {}
                
                # Skip if already encrypted (check if pin or recovery_codes are encrypted)
                pin = profile_data.get('pin')
                codes = profile_data.get('recovery_codes')
                
                needs_migration = False
                
                # Check if PIN needs migration (plaintext = digits only)
                if pin and isinstance(pin, str) and pin.isdigit() and len(pin) <= 6:
                    needs_migration = True
                
                # Check if recovery codes need migration (plaintext = list)
                if codes and isinstance(codes, list):
                    needs_migration = True
                
                if not needs_migration:
                    logger.info(f"User {user.id} ({user.username}): Already encrypted, skipping")
                    continue
                
                # Migrate the data
                updated_profile_data = migrate_profile_data(profile_data)
                
                # Update in database
                await session.execute(
                    update(users).where(
                        users.c.id == user.id
                    ).values(
                        profile_data=updated_profile_data
                    )
                )
                
                updated_count += 1
                logger.info(f"User {user.id} ({user.username}): Encrypted PIN and recovery codes")
                
            except Exception as e:
                logger.error(f"Failed to migrate user {user.id}: {e}")
                continue
        
        # Commit all changes
        await session.commit()
        
        logger.info(f"Migration complete! Updated {updated_count} users.")
        logger.info(f"Skipped {len(all_users) - updated_count} users (already encrypted or no data).")


if __name__ == "__main__":
    asyncio.run(migrate_all_profile_data())
