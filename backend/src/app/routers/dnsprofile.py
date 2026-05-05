import uuid as uuid_lib
import os
import hashlib
from datetime import datetime, timedelta
from fastapi import APIRouter, Query, HTTPException, Request, BackgroundTasks
from fastapi.responses import Response
import jwt as pyjwt
import httpx
from ..routers.auth import JWT_SECRET, JWT_ALGORITHM
from ..db import async_session
from sqlalchemy import select, insert, text

router = APIRouter(prefix="/dns-profile", tags=["dns-profile"])

NEXTDNS_API_KEY = os.environ.get("NEXTDNS_API_KEY", "")
NEXTDNS_CONFIG_ID = os.environ.get("NEXTDNS_CONFIG_ID", "29ddb3")
NEXTDNS_API_BASE = "https://api.nextdns.io"

DEFAULT_BLOCKLIST = [
    "pornhub.com", "xvideos.com", "xhamster.com", "redtube.com",
    "youporn.com", "tube8.com", "spankbang.com", "xnxx.com",
    "1xbet.com", "bet365.com", "pokerstars.com",
]

MOBILECONFIG_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>DNSSettings</key>
            <dict>
                <key>DNSProtocol</key>
                <string>HTTPS</string>
                <key>ServerURL</key>
                <string>https://dns.nextdns.io/{config_id}</string>
                <key>ServerName</key>
                <string>dns.nextdns.io</string>
            </dict>
            <key>PayloadDescription</key>
            <string>GuardianLens DNS filter for {username}</string>
            <key>PayloadDisplayName</key>
            <string>GuardianLens Safe DNS</string>
            <key>PayloadIdentifier</key>
            <string>com.guardianlens.dns.{user_id}</string>
            <key>PayloadType</key>
            <string>com.apple.dnsSettings.managed</string>
            <key>PayloadUUID</key>
            <string>{uuid}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>Installs GuardianLens safe DNS filtering on this device</string>
    <key>PayloadDisplayName</key>
    <string>GuardianLens Parental Filter</string>
    <key>PayloadIdentifier</key>
    <string>com.guardianlens.profile.{user_id}</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>{profile_uuid}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>"""


def decode_token_to_user(token: str) -> dict:
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {
            "user_id": payload.get("user_id") or payload.get("sub"),
            "username": payload.get("username", "child"),
            "account_type": payload.get("account_type", "child"),
        }
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def sync_blocklist_to_nextdns():
    if not NEXTDNS_API_KEY:
        return

    headers = {
        "X-Api-Key": NEXTDNS_API_KEY,
        "Content-Type": "application/json",
    }

    domains_to_block = set(DEFAULT_BLOCKLIST)
    try:
        async with async_session() as session:
            result = await session.execute(
                text("SELECT pattern FROM rules WHERE rule_type='blocklist' AND enabled=true")
            )
            for row in result.fetchall():
                domains_to_block.add(row[0].lower().strip())
    except Exception:
        pass

    async with httpx.AsyncClient() as client:
        try:
            await client.delete(
                f"{NEXTDNS_API_BASE}/profiles/{NEXTDNS_CONFIG_ID}/denylist",
                headers=headers,
                timeout=10.0,
            )
        except Exception:
            pass

        for domain in domains_to_block:
            try:
                await client.post(
                    f"{NEXTDNS_API_BASE}/profiles/{NEXTDNS_CONFIG_ID}/denylist",
                    headers=headers,
                    json={"id": domain, "active": True},
                    timeout=10.0,
                )
            except Exception:
                pass


async def fetch_nextdns_logs(child_id: int = 2):
    if not NEXTDNS_API_KEY:
        return

    headers = {"X-Api-Key": NEXTDNS_API_KEY}

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                f"{NEXTDNS_API_BASE}/profiles/{NEXTDNS_CONFIG_ID}/logs",
                headers=headers,
                params={"limit": 50},
                timeout=10.0,
            )
            if resp.status_code != 200:
                return

            data = resp.json()
            logs = data.get("data", [])

            async with async_session() as session:
                for entry in logs:
                    if not entry.get("blocked"):
                        continue
                    domain = entry.get("domain", "")
                    if not domain:
                        continue
                    domain_hash = hashlib.sha256(domain.encode()).hexdigest()

                    existing = await session.execute(
                        text("SELECT id FROM activity_events WHERE domain_hash=:h AND child_id=:c LIMIT 1"),
                        {"h": domain_hash, "c": child_id}
                    )
                    if existing.fetchone():
                        continue

                    await session.execute(
                        text("""INSERT INTO activity_events
                            (child_id, domain_hash, domain, event_type, blocked_category, event_date, expires_at)
                            VALUES (:child_id, :domain_hash, :domain, :event_type, :blocked_category, :event_date, :expires_at)
                        """),
                        {
                            "child_id": child_id,
                            "domain_hash": domain_hash,
                            "domain": domain,
                            "event_type": "blocked",
                            "blocked_category": "nextdns_filter",
                            "event_date": datetime.utcnow(),
                            "expires_at": datetime.utcnow() + timedelta(days=3),
                        }
                    )
                await session.commit()
        except Exception:
            pass


@router.get("/install")
async def get_dns_profile(token: str = Query(None), background_tasks: BackgroundTasks = None):
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    user = decode_token_to_user(token)

    if background_tasks:
        background_tasks.add_task(sync_blocklist_to_nextdns)

    content = MOBILECONFIG_TEMPLATE.format(
        config_id=NEXTDNS_CONFIG_ID,
        username=user.get("username", "child"),
        user_id=user["user_id"],
        uuid=str(uuid_lib.uuid4()),
        profile_uuid=str(uuid_lib.uuid4()),
    )
    return Response(
        content=content,
        media_type="application/x-apple-aspen-config",
        headers={"Content-Disposition": 'attachment; filename="guardianlens.mobileconfig"'}
    )


@router.post("/sync-rules")
async def sync_rules(background_tasks: BackgroundTasks):
    background_tasks.add_task(sync_blocklist_to_nextdns)
    return {"status": "syncing"}


@router.post("/fetch-logs")
async def trigger_fetch_logs(background_tasks: BackgroundTasks):
    background_tasks.add_task(fetch_nextdns_logs)
    return {"status": "fetching"}


@router.get("/query")
@router.post("/query")
async def dns_query_stub():
    return {"status": "GuardianLens DNS active via NextDNS"}