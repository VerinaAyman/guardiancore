import uuid as uuid_lib
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import Response
from jose import jwt, JWTError
from ..routers.auth import get_current_user, JWT_SECRET, JWT_ALGORITHM
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
                <string>{backend_url}/dns/query</string>
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
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {
            "user_id": payload.get("user_id") or payload.get("sub"),
            "username": payload.get("username", "child"),
            "account_type": payload.get("account_type", "child"),
        }
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

@router.get("/install")
async def get_dns_profile(
    token: str = Query(None),                          # ?token= from Linking.openURL
    current_user: dict = Depends(get_current_user),   # Authorization header fallback
):
    # Prefer query-param token (Safari can't send headers)
    if token:
        user = decode_token_to_user(token)
    else:
        user = current_user

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
        headers={
            "Content-Disposition": 'attachment; filename="guardianlens.mobileconfig"'
        }
    )


@router.get("/query")
async def dns_query():
    """
    Placeholder DoH endpoint.
    Real DoH requires binary DNS wire format — this confirms the route exists.
    """
    return {"status": "GuardianLens DNS active"}