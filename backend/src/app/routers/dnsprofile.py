import uuid as uuid_lib
import os
import hashlib
import base64
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Query, HTTPException, Request, BackgroundTasks
from fastapi.responses import Response
import jwt as pyjwt
import httpx
from ..routers.auth import JWT_SECRET, JWT_ALGORITHM
from ..routers.checkurl import evaluate_url  # Direct import — no HTTP, no auth issue
from ..db import async_session
from sqlalchemy import text

router = APIRouter(prefix="/dns-profile", tags=["dns-profile"])

BACKEND_URL = "https://guardiancore-production.up.railway.app"


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


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc).replace(tzinfo=None)


def decode_token_to_user(token: str) -> dict:
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {
            "user_id":      payload.get("user_id") or payload.get("sub"),
            "username":     payload.get("username", "child"),
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
    tx_id    = query_data[:2]
    flags    = b'\x81\x83'
    counts   = b'\x00\x01\x00\x00\x00\x00\x00\x00'
    question = query_data[12:]
    # SOA record with TTL=5 so unblocks propagate in ~5 seconds
    soa = b'\xc0\x0c\x00\x06\x00\x01\x00\x00\x00\x05\x00\x16'
    soa += b'\x00' * 22
    return tx_id + flags + counts + question + soa


async def ensure_tables():
    """Create all required tables if they don't exist."""
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
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS custom_blocks (
                    id SERIAL PRIMARY KEY,
                    child_id INTEGER NOT NULL,
                    domain TEXT NOT NULL,
                    blocked BOOLEAN NOT NULL DEFAULT true,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(child_id, domain)
                )
            """))
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS dns_heartbeats (
                    child_id INTEGER PRIMARY KEY,
                    profile_active BOOLEAN NOT NULL DEFAULT true,
                    last_seen TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """))
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS activity_events (
                    id SERIAL PRIMARY KEY,
                    child_id INTEGER NOT NULL,
                    domain_hash TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    blocked_category TEXT,
                    duration_seconds INTEGER,
                    has_csp BOOLEAN,
                    has_cors BOOLEAN,
                    event_date TIMESTAMP NOT NULL DEFAULT NOW(),
                    expires_at TIMESTAMP NOT NULL
                )
            """))
            await session.commit()
    except Exception:
        pass


async def get_child_id_for_profile(profile_id: str) -> int:
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
    return 2  # fallback


async def get_child_rules(child_id: int) -> dict:
    defaults = {"porn": True, "gambling": True, "social_media": False, "gaming": False}
    try:
        async with async_session() as session:
            result = await session.execute(
                text("SELECT category, enabled FROM child_dns_rules WHERE child_id = :cid"),
                {"cid": child_id}
            )
            rows = result.fetchall()
            for row in rows:
                defaults[row[0]] = bool(row[1])
    except Exception:
        pass
    return defaults


async def check_custom_block(domain: str, child_id: int) -> tuple[bool, bool]:
    """
    Check parent-defined custom blocks/allows.
    Returns (is_custom_blocked, is_custom_allowed).
    """
    try:
        async with async_session() as session:
            result = await session.execute(
                text("SELECT blocked FROM custom_blocks WHERE child_id = :cid AND (:d = domain OR :d LIKE '%.' || domain) LIMIT 1"),
                {"cid": child_id, "d": domain}
            )
            row = result.fetchone()
            if row is not None:
                return (True, False) if row[0] else (False, True)
    except Exception:
        pass
    return False, False


# ─── DNS query handler ────────────────────────────────────────────────────────

async def resolve_and_classify(domain: str, child_id: int) -> tuple[bool, str]:
    """
    Returns (blocked: bool, category: str).

    Flow:
    1. Custom parent blocks/allowlists (highest priority)
    2. evaluate_url() — which handles infrastructure passthrough,
       hard keyword blocks, and AI classification.
       This is a direct function call — no HTTP, no auth needed.
    3. Parent category rules filter AI results
       (e.g. social_media=OFF means AI-warned social sites still load)
    """
    if not domain or len(domain) < 3:
        return False, ""

    # 1. Custom blocks take priority over everything
    is_custom_blocked, is_custom_allowed = await check_custom_block(domain, child_id)
    if is_custom_blocked:
        return True, "custom_block"
    if is_custom_allowed:
        return False, "custom_allow"

    # 2. Call evaluate_url directly — full AI classification pipeline
    try:
        result = await evaluate_url(f"https://{domain}", child_id)
    except Exception as e:
        print(f"[dns] evaluate_url error for {domain}: {e}")
        return False, ""

    # 3. If AI says block, check if parent has disabled that category
    if result.blocked:
        category = result.category or "ai_blocked"
        rules = await get_child_rules(child_id)

        # Respect parent category toggles — if parent turned OFF social_media
        # blocking, don't block it even if AI flagged it
        if category == "social_media" and not rules.get("social_media", False):
            return False, "warning"  # still warn, just don't block
        if category == "gaming" and not rules.get("gaming", False):
            return False, "warning"
        if category == "porn" and not rules.get("porn", True):
            return False, "warning"
        if category == "gambling" and not rules.get("gambling", True):
            return False, "warning"

        return True, category

    if result.warning:
        return False, "warning"

    return False, ""


async def log_dns_event(domain: str, child_id: int, event_type: str, category: str = ""):
    try:
        print(f"[dns] log_dns_event called: {event_type} {domain} child={child_id}")
        async with async_session() as session:
            now = _utcnow()
            domain_hash = hashlib.sha256(
                f"{domain}:{child_id}:{event_type}:{now.isoformat()}".encode()
            ).hexdigest()
            await session.execute(
                text("""
                    INSERT INTO activity_events
                        (child_id, domain_hash, domain, event_type, blocked_category,
                         event_date, expires_at)
                    VALUES
                        (:child_id, :domain_hash, :domain, :event_type, :blocked_category,
                         :event_date, :expires_at)
                """),
                {
                    "child_id":         child_id,
                    "domain_hash":      domain_hash,
                    "domain":           domain,
                    "event_type":       event_type,
                    "blocked_category": category if category else None,
                    "event_date":       now,
                    "expires_at":       now + timedelta(days=3),
                }
            )
            await session.commit()
            print(f"[dns] log_dns_event success: {event_type} {domain} child={child_id}")
    except Exception as e:
        print(f"[dns] log_dns_event ERROR: {e}")
        import traceback
        traceback.print_exc()

async def resolve_upstream(query_data: bytes) -> bytes:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://8.8.8.8/dns-query",
            content=query_data,
            headers={"Content-Type": "application/dns-message"},
            timeout=5.0,
        )
        return resp.content


# ========== ENDPOINTS ==========

@router.get("/install")
async def get_dns_profile(
    token: str = Query(None),
    child_id: int = Query(None),
    background_tasks: BackgroundTasks = None
):
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    user = decode_token_to_user(token)

    if user["account_type"] == "parent":
        if not child_id:
            raise HTTPException(status_code=400, detail="child_id required for parent installs")
        target_child_id = child_id
        try:
            async with async_session() as session:
                result = await session.execute(
                    text("SELECT id FROM children WHERE id = :cid AND parent_id = :pid"),
                    {"cid": child_id, "pid": user["user_id"]}
                )
                if not result.fetchone():
                    raise HTTPException(status_code=403, detail="Child not found")
                name_result = await session.execute(
                    text("SELECT username FROM children WHERE id = :cid"),
                    {"cid": child_id}
                )
                child_row     = name_result.fetchone()
                child_username = child_row[0] if child_row else "child"
        except HTTPException:
            raise
        except Exception:
            child_username = "child"
    else:
        target_child_id = user["user_id"]
        child_username  = user.get("username", "child")

    profile_id = hashlib.sha256(f"profile:{target_child_id}".encode()).hexdigest()[:32]

    if background_tasks:
        background_tasks.add_task(ensure_tables)

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
                "pid":   profile_id,
                "cid":   target_child_id,
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
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    rules = await get_child_rules(child_id)
    return {"child_id": child_id, "rules": rules}


@router.post("/rules/{child_id}")
async def update_rules(child_id: int, request: Request, token: str = Query(None)):
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


@router.get("/custom-block/{child_id}")
async def get_custom_blocks(child_id: int, token: str = Query(None)):
    try:
        async with async_session() as session:
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS custom_blocks (
                    id SERIAL PRIMARY KEY,
                    child_id INTEGER NOT NULL,
                    domain TEXT NOT NULL,
                    blocked BOOLEAN NOT NULL DEFAULT true,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(child_id, domain)
                )
            """))
            await session.commit()
            result = await session.execute(
                text("SELECT domain, blocked FROM custom_blocks WHERE child_id = :cid ORDER BY created_at DESC"),
                {"cid": child_id}
            )
            rows = result.fetchall()
            return {"child_id": child_id, "domains": [{"domain": r[0], "blocked": r[1]} for r in rows]}
    except Exception:
        return {"child_id": child_id, "domains": []}


@router.post("/custom-block/{child_id}")
async def set_custom_block(child_id: int, request: Request, token: str = Query(None)):
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    body   = await request.json()
    domain  = body.get("domain", "").lower().strip()
    blocked = body.get("blocked", True)
    if not domain:
        raise HTTPException(status_code=400, detail="domain required")
    try:
        async with async_session() as session:
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS custom_blocks (
                    id SERIAL PRIMARY KEY,
                    child_id INTEGER NOT NULL,
                    domain TEXT NOT NULL,
                    blocked BOOLEAN NOT NULL DEFAULT true,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(child_id, domain)
                )
            """))
            await session.execute(text("""
                INSERT INTO custom_blocks (child_id, domain, blocked)
                VALUES (:cid, :domain, :blocked)
                ON CONFLICT (child_id, domain) DO UPDATE SET blocked = :blocked
            """), {"cid": child_id, "domain": domain, "blocked": blocked})
            await session.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"child_id": child_id, "domain": domain, "blocked": blocked}


@router.post("/heartbeat")
async def dns_heartbeat(request: Request):
    body           = await request.json()
    child_id       = body.get("child_id")
    profile_active = body.get("profile_active", True)
    if not child_id:
        return {"status": "ok"}
    try:
        async with async_session() as session:
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS dns_heartbeats (
                    child_id INTEGER PRIMARY KEY,
                    profile_active BOOLEAN NOT NULL DEFAULT true,
                    last_seen TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """))
            await session.execute(text("""
                INSERT INTO dns_heartbeats (child_id, profile_active, last_seen)
                VALUES (:cid, :active, NOW())
                ON CONFLICT (child_id) DO UPDATE SET profile_active = :active, last_seen = NOW()
            """), {"cid": child_id, "active": profile_active})
            await session.commit()
    except Exception:
        pass
    return {"status": "ok"}


@router.get("/heartbeat/status/{child_id}")
async def get_heartbeat_status(child_id: int, token: str = Query(None)):
    try:
        async with async_session() as session:
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS dns_heartbeats (
                    child_id INTEGER PRIMARY KEY,
                    profile_active BOOLEAN NOT NULL DEFAULT true,
                    last_seen TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """))
            await session.commit()
            result = await session.execute(
                text("SELECT profile_active, last_seen FROM dns_heartbeats WHERE child_id = :cid"),
                {"cid": child_id}
            )
            row = result.fetchone()
            if not row:
                return {"child_id": child_id, "status": "unknown", "last_seen": None}

            active      = row[0]
            last_seen   = row[1]
            minutes_ago = (_utcnow() - last_seen).total_seconds() / 60

            if minutes_ago > 10:
                status = "offline"
            elif not active:
                status = "removed"
            else:
                status = "active"

            return {
                "child_id":    child_id,
                "status":      status,
                "last_seen":   last_seen.isoformat(),
                "minutes_ago": round(minutes_ago, 1),
            }
    except Exception as e:
        return {"child_id": child_id, "status": "unknown", "error": str(e)}


@router.post("/sync-rules")
async def sync_rules(background_tasks: BackgroundTasks):
    return {"status": "syncing"}


@router.post("/fetch-logs")
async def trigger_fetch_logs(background_tasks: BackgroundTasks):
    return {"status": "fetching"}


@router.get("/query")
@router.post("/query")
async def dns_query(
    request: Request,
    dns: str = Query(None),
    profile_id: str = Query(None)
):
    query_data = b""
    try:
        if request.method == "POST":
            query_data = await request.body()
        elif dns:
            padding    = 4 - len(dns) % 4
            query_data = base64.urlsafe_b64decode(dns + "=" * padding)
        else:
            raise HTTPException(status_code=400, detail="No DNS query provided")

        child_id           = await get_child_id_for_profile(profile_id) if profile_id else 2
        domain             = parse_dns_query(query_data)
        blocked, category  = await resolve_and_classify(domain, child_id=child_id)

        if blocked:
            await log_dns_event(domain, child_id, event_type="blocked", category=category)
            return Response(
                content=build_nxdomain_response(query_data),
                media_type="application/dns-message"
            )
        elif category == "warning":
            await log_dns_event(domain, child_id, event_type="warning", category="warning")
            upstream = await resolve_upstream(query_data)
            return Response(content=upstream, media_type="application/dns-message")
        else:
            if domain:
                await log_dns_event(domain, child_id, event_type="visit", category="")
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