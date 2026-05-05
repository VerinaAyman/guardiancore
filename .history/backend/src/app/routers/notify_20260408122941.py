"""
Notify router — sends parent report emails privately.
The block page never shows the parent report to the child (Paper 26 dignity gap).
This endpoint is called fire-and-forget from background.js after a block event.
"""

import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from .auth import get_current_user
from ..db import async_session, users
from ..config import settings
from sqlalchemy import select

router = APIRouter(prefix="/notify", tags=["notifications"])
logger = logging.getLogger(__name__)


class ParentReportPayload(BaseModel):
    child_id: int
    url: str
    category: str
    parent_report: str
    trigger_words: list[str] = []


def send_email(to_email: str, subject: str, html_body: str) -> bool:
    """Send email via Gmail SMTP. Returns True on success."""
    if not settings.GMAIL_USER or not settings.GMAIL_APP_PASSWORD:
        logger.warning("[Notify] Gmail not configured — logging report instead")
        logger.info(f"[Notify] PARENT REPORT TO {to_email}:\n{html_body}")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"GuardianLens <{settings.GMAIL_USER}>"
        msg["To"] = to_email
        msg.attach(MIMEText(html_body, "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(settings.GMAIL_USER, settings.GMAIL_APP_PASSWORD)
            server.sendmail(settings.GMAIL_USER, to_email, msg.as_string())
        logger.info(f"[Notify] Parent report email sent to {to_email}")
        return True
    except Exception as e:
        logger.error(f"[Notify] Failed to send email: {e}")
        return False


def build_email_html(payload: ParentReportPayload) -> str:
    tokens_html = ""
    if payload.trigger_words:
        chips = "".join(
            f'<span style="display:inline-block;padding:3px 10px;margin:3px;'
            f'background:#fee2e2;color:#991b1b;border-radius:6px;font-size:13px;">'
            f'{t}</span>'
            for t in payload.trigger_words
        )
        tokens_html = f"""
        <div style="margin-top:16px">
          <p style="font-size:12px;color:#6b7280;text-transform:uppercase;
                    letter-spacing:.1em;margin-bottom:8px">Trigger words</p>
          <div>{chips}</div>
        </div>"""

    return f"""
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;
                background:#f8fafc;padding:32px;border-radius:12px">
      <p style="font-size:12px;color:#6b7280;text-transform:uppercase;
                letter-spacing:.1em;margin:0 0 8px">GuardianLens Safety Alert</p>
      <h1 style="font-size:22px;font-weight:600;color:#0f172a;margin:0 0 24px">
        Content flagged for your child</h1>

      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;
                  padding:20px;margin-bottom:16px">
        <p style="font-size:12px;color:#6b7280;text-transform:uppercase;
                  letter-spacing:.1em;margin:0 0 6px">Page visited</p>
        <p style="font-size:14px;color:#0f172a;word-break:break-all;margin:0">
          {payload.url}</p>
      </div>

      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;
                  padding:20px;margin-bottom:16px">
        <p style="font-size:12px;color:#6b7280;text-transform:uppercase;
                  letter-spacing:.1em;margin:0 0 6px">Category</p>
        <p style="font-size:14px;color:#0f172a;margin:0">{payload.category}</p>
      </div>

      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;
                  padding:20px;margin-bottom:16px">
        <p style="font-size:12px;color:#6b7280;text-transform:uppercase;
                  letter-spacing:.1em;margin:0 0 6px">Full report</p>
        <p style="font-size:14px;color:#374151;line-height:1.6;margin:0">
          {payload.parent_report}</p>
        {tokens_html}
      </div>

      <p style="font-size:12px;color:#94a3b8;text-align:center;margin-top:24px">
        GuardianLens · this report was sent privately and was not shown to your child</p>
    </div>"""


@router.post("/parent-report")
async def send_parent_report(
    payload: ParentReportPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    Called fire-and-forget from background.js when a child hits a block.
    Looks up the parent's email and sends the report privately.
    """
    try:
        async with async_session() as session:
            # Get child record to find parent_id
            child = await session.execute(
                select(users).where(users.c.id == payload.child_id)
            )
            child_row = child.fetchone()
            if not child_row:
                return {"ok": False, "reason": "child_not_found"}

            # Get parent email via parent_id
            parent = await session.execute(
                select(users).where(users.c.id == child_row.parent_id)
            )
            parent_row = parent.fetchone()
            if not parent_row or not parent_row.email:
                logger.warning(f"[Notify] No parent email for child {payload.child_id}")
                return {"ok": False, "reason": "no_parent_email"}

        subject = f"GuardianLens: content flagged — {payload.category}"
        html = build_email_html(payload)
        sent = send_email(parent_row.email, subject, html)
        return {"ok": True, "emailed": sent}

    except Exception as e:
        logger.error(f"[Notify] Endpoint error: {e}")
        return {"ok": False, "reason": str(e)}