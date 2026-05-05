import uuid as uuid_lib
import os
import hashlib
import base64
from datetime import datetime, timedelta
from fastapi import APIRouter, Query, HTTPException, Request, BackgroundTasks
from fastapi.responses import Response
import jwt as pyjwt
import httpx
from ..routers.auth import JWT_SECRET, JWT_ALGORITHM
from ..db import async_session
from sqlalchemy import text

router = APIRouter(prefix="/dns-profile", tags=["dns-profile"])

BACKEND_URL = "https://guardiancore-production.up.railway.app"
NEXTDNS_API_KEY = os.environ.get("NEXTDNS_API_KEY", "")
NEXTDNS_CONFIG_ID = os.environ.get("NEXTDNS_CONFIG_ID", "29ddb3")
NEXTDNS_API_BASE = "https://api.nextdns.io"

DEFAULT_BLOCKLIST = {
    "pornhub.com", "xvideos.com", "xhamster.com", "redtube.com",
    "youporn.com", "tube8.com", "spankbang.com", "xnxx.com",
    "1xbet.com", "bet365.com", "pokerstars.com",
}

BLOCK_KEYWORDS = ["porn", "xxx", "adult", "sex", "nude", "csam", "darkweb"]

SAFE_DOMAINS = {
    "apple.com", "icloud.com", "googleapis.com", "gstatic.com",
    "cloudflare.com", "akamai.net", "fastly.net", "whatsapp.net",
    "whatsapp.com", "facebook.com", "instagram.com", "google.com",
    "youtube.com", "twitter.com", "x.com", "amazon.com",
    "microsoft.com", "windows.com", "live.com", "office.com",
    "cdn.apple.com", "mzstatic.com", "apple-dns.net", "applecdn.net",
}

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
                <string>https://guardiancore-production.up.railway.app/dns-profile/query?profile_id={profile_id}</string>
                <key>ServerName</key>
                <string>guardiancore-production.up.railway.app</string>
            </dict>
            <key>PayloadDescription</key>
            <string>GuardianLens DNS filter for {username}</string>
            <key>PayloadDisplayName</key>
            <string>GuardianLens Safe DNS</string>
            <key>PayloadIdentifier</key>
            <string>com.guardianlens.dns.{child_id}</string>
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
    <string>com.guardianlens.profile.{child_id}</string>
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


def parse_dns_query(data: bytes) -> str:
    try:
        pos = 12
        labels = []
        while pos < len(data):
            length = data[pos]
            if length == 0:
                break
            pos += 1
            labels.append(data[pos:pos + length].decode())
            pos += length
        return ".".join(labels).lower()
    except Exception:
        return ""


def build_nxdomain_response(query_data: bytes) -> bytes:
    tx_id = query_data[:2]
    flags = b'\x81\x83'
    counts = b'\x00\x01\x00\x00\x00\x00\x00\x00'
    question = query_data[12:]
    return tx_id + flags + counts + question


async def get_child_id_for_profile(profile_id: str) -> int:
    """Look up which child this DNS profile belongs to."""
    try:
        async with async_session() as session:
            result = await session.execute(
                text("SELECT child_id FROM dns_profiles WHERE profile_id = :pid LIMIT 1"),
                {"pid": profile_id}
            )
            row = result.fetchone()
            if row:
                return row[0]
    except Exception:
        pass
    return 2  # fallback to David if table doesn't exist yet


async def get_child_rules(child_id: int) -> dict:
    """
    Get per-child blocking rules. Returns dict of category -> enabled.
    e.g. {"porn": True, "gambling": True, "social_media": False}
    """
    defaults = {"porn": True, "gambling": True, "social_media": False, "gaming": False}
    try:
        async with async_session() as session:
            result = await session.execute(
                text("SELECT category, enabled FROM child_dns_rules WHERE child_id = :cid"),
                {"cid": child_id}
            )
            rows = result.fetchall()
            if rows:
                for row in rows:
                    defaults[row[0]] = bool(row[1])
    except Exception:
        pass
    return defaults


async def check_domain_against_rules(domain: str, child_id: int = 2) -> tuple[bool, str]:
    """Returns (blocked, category). Uses hardcoded list + keywords + per-child rules + AI."""
    if not domain or len(domain) < 3:
        return False, ""

    # Check per-child rules
    rules = await get_child_rules(child_id)

    # Hardcoded blocklist
    parts = domain.split(".")
    for i in range(len(parts) - 1):
        candidate = ".".join(parts[i:])
        if candidate in DEFAULT_BLOCKLIST:
            return True, "explicit_blocklist"

    # Keyword check (respects rules)
    porn_keywords = ["porn", "xxx", "adult", "nude", "csam"]
    gambling_keywords = ["bet", "casino", "poker", "gambling", "slots"]
    social_keywords = ["tiktok.com", "snapchat.com"]
    gaming_keywords = ["roblox.com", "miniclip.com", "addictinggames.com"]

    if rules.get("porn", True):
        for kw in porn_keywords:
            if kw in domain:
                return True, "porn"

    if rules.get("gambling", True):
        for kw in gambling_keywords:
            if kw in domain:
                return True, "gambling"

    if rules.get("social_media", False):
        for kw in social_keywords:
            if kw in domain:
                return True, "social_media"

    if rules.get("gaming", False):
        for kw in gaming_keywords:
            if kw in domain:
                return True, "gaming"

    # Skip AI for known safe domains
    for i in range(len(parts) - 1):
        candidate = ".".join(parts[i:])
        if candidate in SAFE_DOMAINS:
            return False, ""

    # AI classification for unknown domains
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{BACKEND_URL}/check-url/",
                json={"url": f"https://{domain}", "child_id": child_id},
                headers={"Content-Type": "application/json"},
                timeout=3.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("blocked"):
                    category = data.get("category") or "ai_blocked"
                    # Respect per-child rules even for AI results
                    if category == "social_media" and not rules.get("social_media", False):
                        return False, ""
                    if category == "gaming" and not rules.get("gaming", False):
                        return False, ""
                    return True, category
                if data.get("warning"):
                    return False, "warning"
    except Exception:
        pass

    return False, ""


async def log_blocked_domain(domain: str, child_id: int = 2, category: str = "dns_filter"):
    try:
        async with async_session() as session:
            domain_hash = hashlib.sha256(f"{domain}:{child_id}".encode()).hexdigest()
            await session.execute(
                text("""INSERT INTO activity_events
                    (child_id, domain_hash, domain, event_type, blocked_category, event_date, expires_at)
                    VALUES (:child_id, :domain_hash, :domain, :event_type, :blocked_category, :event_date, :expires_at)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "child_id": child_id,
                    "domain_hash": domain_hash,
                    "domain": domain,
                    "event_type": "blocked",
                    "blocked_category": category,
                    "event_date": datetime.utcnow(),
                    "expires_at": datetime.utcnow() + timedelta(days=3),
                }
            )
            await session.commit()
    except Exception:
        pass


async def log_warning_domain(domain: str, child_id: int = 2):
    try:
        async with async_session() as session:
            domain_hash = hashlib.sha256(f"{domain}:{child_id}:warn".encode()).hexdigest()
            await session.execute(
                text("""INSERT INTO activity_events
                    (child_id, domain_hash, domain, event_type, blocked_category, event_date, expires_at)
                    VALUES (:child_id, :domain_hash, :domain, :event_type, :blocked_category, :event_date, :expires_at)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "child_id": child_id,
                    "domain_hash": domain_hash,
                    "domain": domain,
                    "event_type": "warning",
                    "blocked_category": "warning",
                    "event_date": datetime.utcnow(),
                    "expires_at": datetime.utcnow() + timedelta(days=3),
                }
            )
            await session.commit()
    except Exception:
        pass


async def resolve_upstream(query_data: bytes) -> bytes:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://8.8.8.8/dns-query",
            content=query_data,
            headers={"Content-Type": "application/dns-message"},
            timeout=5.0,
        )
        return resp.content


async def ensure_profile_tables():
    """Create dns_profiles and child_dns_rules tables if they don't exist."""
    try:
        async with async_session() as session:
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS dns_profiles (
                    profile_id TEXT PRIMARY KEY,
                    child_id INTEGER NOT NULL,
                    parent_id INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS child_dns_rules (
                    id SERIAL PRIMARY KEY,
                    child_id INTEGER NOT NULL,
                    category TEXT NOT NULL,
                    enabled BOOLEAN NOT NULL DEFAULT true,
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(child_id, category)
                )
            """))
            await session.commit()
    except Exception:
        pass


@router.get("/install")
async def get_dns_profile(
    token: str = Query(None),
    child_id: int = Query(None),
    background_tasks: BackgroundTasks = None
):
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    user = decode_token_to_user(token)

    # Parent must specify which child this profile is for
    if user["account_type"] == "parent":
        if not child_id:
            raise HTTPException(status_code=400, detail="child_id required for parent installs")
        target_child_id = child_id
        # Verify parent owns child
        try:
            async with async_session() as session:
                result = await session.execute(
                    text("SELECT id FROM children WHERE id = :cid AND parent_id = :pid"),
                    {"cid": child_id, "pid": user["user_id"]}
                )
                if not result.fetchone():
                    raise HTTPException(status_code=403, detail="Child not found")
                # Get child username
                name_result = await session.execute(
                    text("SELECT username FROM children WHERE id = :cid"),
                    {"cid": child_id}
                )
                child_row = name_result.fetchone()
                child_username = child_row[0] if child_row else "child"
        except HTTPException:
            raise
        except Exception:
            child_username = "child"
    else:
        target_child_id = user["user_id"]
        child_username = user.get("username", "child")

    # Generate a stable profile_id tied to this child
    profile_id = hashlib.sha256(f"profile:{target_child_id}".encode()).hexdigest()[:32]

    # Store mapping in DB
    if background_tasks:
        background_tasks.add_task(ensure_profile_tables)

    try:
        async with async_session() as session:
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS dns_profiles (
                    profile_id TEXT PRIMARY KEY,
                    child_id INTEGER NOT NULL,
                    parent_id INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            await session.execute(text("""
                INSERT INTO dns_profiles (profile_id, child_id, parent_id)
                VALUES (:pid, :cid, :parid)
                ON CONFLICT (profile_id) DO UPDATE SET child_id = :cid
            """), {
                "pid": profile_id,
                "cid": target_child_id,
                "parid": user["user_id"],
            })
            await session.commit()
    except Exception:
        pass

    content = MOBILECONFIG_TEMPLATE.format(
        profile_id=profile_id,
        username=child_username,
        child_id=target_child_id,
        uuid=str(uuid_lib.uuid4()),
        profile_uuid=str(uuid_lib.uuid4()),
    )
    return Response(
        content=content,
        media_type="application/x-apple-aspen-config",
        headers={"Content-Disposition": 'attachment; filename="guardianlens.mobileconfig"'}
    )


@router.get("/rules/{child_id}")
async def get_rules(child_id: int, token: str = Query(None)):
    """Get blocking rules for a child."""
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    rules = await get_child_rules(child_id)
    return {"child_id": child_id, "rules": rules}


@router.post("/rules/{child_id}")
async def update_rules(child_id: int, request: Request, token: str = Query(None)):
    """Update blocking rules for a child. Body: {category: bool, ...}"""
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    body = await request.json()
    try:
        async with async_session() as session:
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS child_dns_rules (
                    id SERIAL PRIMARY KEY,
                    child_id INTEGER NOT NULL,
                    category TEXT NOT NULL,
                    enabled BOOLEAN NOT NULL DEFAULT true,
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(child_id, category)
                )
            """))
            for category, enabled in body.items():
                await session.execute(text("""
                    INSERT INTO child_dns_rules (child_id, category, enabled)
                    VALUES (:cid, :cat, :en)
                    ON CONFLICT (child_id, category) DO UPDATE SET enabled = :en, updated_at = NOW()
                """), {"cid": child_id, "cat": category, "en": bool(enabled)})
            await session.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"child_id": child_id, "rules": body}


@router.post("/sync-rules")
async def sync_rules(background_tasks: BackgroundTasks):
    background_tasks.add_task(lambda: None)
    return {"status": "syncing"}


@router.post("/fetch-logs")
async def trigger_fetch_logs(background_tasks: BackgroundTasks):
    return {"status": "fetching"}


@router.get("/query")
@router.post("/query")
async def dns_query(request: Request, dns: str = Query(None), profile_id: str = Query(None)):
    query_data = b""
    try:
        if request.method == "POST":
            query_data = await request.body()
        elif dns:
            padding = 4 - len(dns) % 4
            query_data = base64.urlsafe_b64decode(dns + "=" * padding)
        else:
            raise HTTPException(status_code=400, detail="No DNS query provided")

        # Look up which child this profile belongs to
        child_id = await get_child_id_for_profile(profile_id) if profile_id else 2

        domain = parse_dns_query(query_data)
        blocked, category = await check_domain_against_rules(domain, child_id=child_id)

        if blocked:
            await log_blocked_domain(domain, child_id=child_id, category=category)
            return Response(
                content=build_nxdomain_response(query_data),
                media_type="application/dns-message"
            )
        elif category == "warning":
            await log_warning_domain(domain, child_id=child_id)
            upstream = await resolve_upstream(query_data)
            return Response(content=upstream, media_type="application/dns-message")
        else:
            upstream = await resolve_upstream(query_data)
            return Response(content=upstream, media_type="application/dns-message")

    except HTTPException:
        raise
    except Exception as e:
        try:
            upstream = await resolve_upstream(query_data)
            return Response(content=upstream, media_type="application/dns-message")
        except Exception:
            raise HTTPException(status_code=500, detail=str(e))