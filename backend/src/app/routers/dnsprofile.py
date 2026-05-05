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

NEXTDNS_API_KEY = os.environ.get("NEXTDNS_API_KEY", "")
NEXTDNS_CONFIG_ID = os.environ.get("NEXTDNS_CONFIG_ID", "29ddb3")
NEXTDNS_API_BASE = "https://api.nextdns.io"
BACKEND_URL = "https://guardiancore-production.up.railway.app"

DEFAULT_BLOCKLIST = {
    "pornhub.com", "xvideos.com", "xhamster.com", "redtube.com",
    "youporn.com", "tube8.com", "spankbang.com", "xnxx.com",
    "1xbet.com", "bet365.com", "pokerstars.com",
}

BLOCK_KEYWORDS = ["porn", "xxx", "adult", "sex", "nude", "csam", "darkweb"]

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
                <string>https://guardiancore-production.up.railway.app/dns-profile/query</string>
                <key>ServerName</key>
                <string>guardiancore-production.up.railway.app</string>
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


async def check_domain_against_rules(domain: str) -> tuple[bool, str]:
    """Returns (blocked, category). Uses hardcoded list + keywords + AI."""
    if not domain or len(domain) < 3:
        return False, ""

    # Hardcoded blocklist — instant, no AI call needed
    parts = domain.split(".")
    for i in range(len(parts) - 1):
        candidate = ".".join(parts[i:])
        if candidate in DEFAULT_BLOCKLIST:
            return True, "explicit_blocklist"

    # Keyword check
    for kw in BLOCK_KEYWORDS:
        if kw in domain:
            return True, "keyword_match"

    # Skip AI for common safe domains to avoid latency
    SAFE_DOMAINS = {
        "apple.com", "icloud.com", "googleapis.com", "gstatic.com",
        "cloudflare.com", "akamai.net", "fastly.net", "whatsapp.net",
        "whatsapp.com", "facebook.com", "instagram.com", "google.com",
        "youtube.com", "twitter.com", "x.com", "amazon.com",
        "microsoft.com", "windows.com", "live.com", "office.com",
    }
    for i in range(len(parts) - 1):
        candidate = ".".join(parts[i:])
        if candidate in SAFE_DOMAINS:
            return False, ""

    # AI classification for unknown domains
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{BACKEND_URL}/check-url/",
                json={"url": f"https://{domain}", "child_id": 2},
                headers={"Content-Type": "application/json"},
                timeout=3.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("blocked"):
                    return True, data.get("category") or "ai_blocked"
                if data.get("warning"):
                    # Log as warning but don't block
                    return False, "warning"
    except Exception:
        pass

    return False, ""


async def log_blocked_domain(domain: str, child_id: int = 2, category: str = "dns_filter"):
    try:
        async with async_session() as session:
            domain_hash = hashlib.sha256(domain.encode()).hexdigest()
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
            domain_hash = hashlib.sha256((domain + "_warn").encode()).hexdigest()
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


async def sync_blocklist_to_nextdns():
    if not NEXTDNS_API_KEY:
        return
    headers = {"X-Api-Key": NEXTDNS_API_KEY, "Content-Type": "application/json"}
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
            await client.delete(f"{NEXTDNS_API_BASE}/profiles/{NEXTDNS_CONFIG_ID}/denylist", headers=headers, timeout=10.0)
        except Exception:
            pass
        for domain in domains_to_block:
            try:
                await client.post(f"{NEXTDNS_API_BASE}/profiles/{NEXTDNS_CONFIG_ID}/denylist", headers=headers, json={"id": domain, "active": True}, timeout=10.0)
            except Exception:
                pass


async def fetch_nextdns_logs(child_id: int = 2):
    if not NEXTDNS_API_KEY:
        return
    headers = {"X-Api-Key": NEXTDNS_API_KEY}
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{NEXTDNS_API_BASE}/profiles/{NEXTDNS_CONFIG_ID}/logs", headers=headers, params={"limit": 50}, timeout=10.0)
            if resp.status_code != 200:
                return
            logs = resp.json().get("data", [])
            async with async_session() as session:
                for entry in logs:
                    if not entry.get("blocked"):
                        continue
                    domain = entry.get("domain", "")
                    if not domain:
                        continue
                    domain_hash = hashlib.sha256(domain.encode()).hexdigest()
                    existing = await session.execute(text("SELECT id FROM activity_events WHERE domain_hash=:h AND child_id=:c LIMIT 1"), {"h": domain_hash, "c": child_id})
                    if existing.fetchone():
                        continue
                    await session.execute(text("""INSERT INTO activity_events (child_id, domain_hash, domain, event_type, blocked_category, event_date, expires_at) VALUES (:child_id, :domain_hash, :domain, :event_type, :blocked_category, :event_date, :expires_at)"""), {"child_id": child_id, "domain_hash": domain_hash, "domain": domain, "event_type": "blocked", "blocked_category": "nextdns_filter", "event_date": datetime.utcnow(), "expires_at": datetime.utcnow() + timedelta(days=3)})
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
async def dns_query(request: Request, dns: str = Query(None)):
    query_data = b""
    try:
        if request.method == "POST":
            query_data = await request.body()
        elif dns:
            padding = 4 - len(dns) % 4
            query_data = base64.urlsafe_b64decode(dns + "=" * padding)
        else:
            raise HTTPException(status_code=400, detail="No DNS query provided")

        domain = parse_dns_query(query_data)
        blocked, category = await check_domain_against_rules(domain)

        if blocked:
            await log_blocked_domain(domain, category=category)
            return Response(
                content=build_nxdomain_response(query_data),
                media_type="application/dns-message"
            )
        elif category == "warning":
            await log_warning_domain(domain)
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