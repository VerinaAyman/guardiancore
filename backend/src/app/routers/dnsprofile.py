from fastapi import APIRouter, Depends
from fastapi.responses import Response
from ..routers.auth import get_current_user

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

@router.get("/install")
async def get_dns_profile(current_user: dict = Depends(get_current_user)):
    import uuid
    content = MOBILECONFIG_TEMPLATE.format(
        backend_url=BACKEND_URL,
        username=current_user.get("username", "child"),
        user_id=current_user["user_id"],
        uuid=str(uuid.uuid4()),
        profile_uuid=str(uuid.uuid4()),
    )
    return Response(
        content=content,
        media_type="application/x-apple-aspen-config",
        headers={
            "Content-Disposition": f'attachment; filename="guardianlens.mobileconfig"'
        }
    )


@router.get("/query")
async def dns_query():
    """
    Placeholder DoH endpoint.
    Real DoH requires binary DNS wire format - this confirms the route exists.
    """
    return {"status": "GuardianLens DNS active"}