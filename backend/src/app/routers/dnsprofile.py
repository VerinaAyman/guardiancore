import uuid as uuid_lib
import struct
import base64
from fastapi import APIRouter, Depends, Query, HTTPException, Request
from fastapi.responses import Response
import jwt as pyjwt
from ..routers.auth import JWT_SECRET, JWT_ALGORITHM
from ..db import async_session
from sqlalchemy import select, text

router = APIRouter(prefix="/dns-profile", tags=["dns-profile"])
BACKEND_URL = "https://guardiancore-production.up.railway.app"

# Hardcoded blocklist for now — we'll hook into DB rules next
BLOCKLIST = {
    "pornhub.com", "xvideos.com", "xhamster.com", "redtube.com",
    "youporn.com", "tube8.com", "spankbang.com", "xnxx.com",
    "1xbet.com", "bet365.com", "pokerstars.com",
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
                <string>{backend_url}/dns-profile/query</string>
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
    """Extract domain name from DNS wire format query."""
    try:
        # Skip 12-byte header
        pos = 12
        labels = []
        while pos < len(data):
            length = data[pos]
            if length == 0:
                break
            pos += 1
            labels.append(data[pos:pos+length].decode())
            pos += length
        return ".".join(labels).lower()
    except Exception:
        return ""


def build_nxdomain_response(query_data: bytes) -> bytes:
    """Build a DNS NXDOMAIN response to block a domain."""
    # Copy transaction ID from query
    tx_id = query_data[:2]
    # Flags: response, NXDOMAIN (rcode=3)
    flags = b'\x81\x83'
    # 1 question, 0 answers, 0 authority, 0 additional
    counts = b'\x00\x01\x00\x00\x00\x00\x00\x00'
    # Copy question section from query (everything after 12-byte header)
    question = query_data[12:]
    return tx_id + flags + counts + question


def build_passthrough_response(query_data: bytes, upstream_response: bytes) -> bytes:
    """Return the upstream DNS response as-is."""
    return upstream_response


async def resolve_upstream(query_data: bytes) -> bytes:
    """Forward DNS query to Google's DoH server."""
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://8.8.8.8/dns-query",
            content=query_data,
            headers={"Content-Type": "application/dns-message"},
            timeout=5.0,
        )
        return resp.content


def is_blocked(domain: str) -> bool:
    """Check if domain or any parent domain is in blocklist."""
    if not domain:
        return False
    parts = domain.split(".")
    for i in range(len(parts) - 1):
        candidate = ".".join(parts[i:])
        if candidate in BLOCKLIST:
            return True
    return False


@router.get("/install")
async def get_dns_profile(token: str = Query(None)):
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    user = decode_token_to_user(token)
    content = MOBILECONFIG_TEMPLATE.format(
        backend_url=BACKEND_URL,
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


@router.post("/query")
@router.get("/query")
async def dns_query(request: Request, dns: str = Query(None)):
    """
    DNS-over-HTTPS endpoint. Handles both GET (?dns=base64) and POST (binary body).
    Blocks domains in BLOCKLIST, forwards everything else to Google DNS.
    """
    try:
        # Parse query data
        if request.method == "POST":
            query_data = await request.body()
        elif dns:
            # GET request with base64url-encoded DNS query
            query_data = base64.urlsafe_b64decode(dns + "==")
        else:
            raise HTTPException(status_code=400, detail="No DNS query provided")

        # Extract domain
        domain = parse_dns_query(query_data)

        if is_blocked(domain):
            # Return NXDOMAIN to block the domain
            response_data = build_nxdomain_response(query_data)
            return Response(
                content=response_data,
                media_type="application/dns-message"
            )
        else:
            # Forward to Google DNS
            upstream = await resolve_upstream(query_data)
            return Response(
                content=upstream,
                media_type="application/dns-message"
            )

    except HTTPException:
        raise
    except Exception as e:
        # On any error, fail open (allow) so we don't break internet
        try:
            upstream = await resolve_upstream(query_data)
            return Response(content=upstream, media_type="application/dns-message")
        except Exception:
            raise HTTPException(status_code=500, detail=str(e))