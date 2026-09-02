from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Response
from fastapi.responses import Response as RawResponse
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
import logging
from pydantic import BaseModel, Field

from middleware.auth import verify_jwt
from lib.supabase_client import supabase
from services.email.template_generator import generate_recipient_template
from services.email.excel_parser import parse_recipient_spreadsheet
from services.email.service import get_email_service
from app.workers.email_worker import email_worker

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/email-campaigns", tags=["Email Campaigns"])


# ── Pydantic Request Models ──

class CampaignCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    subject: str = Field(..., min_length=1, max_length=300)
    html_body: str = Field(..., min_length=1)
    text_body: Optional[str] = None
    from_name: Optional[str] = "UNAI Flow"
    reply_to: Optional[str] = None
    recipients: Optional[List[Dict[str, Any]]] = []
    status: Optional[str] = "draft"  # "draft" or "queued"

class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    html_body: Optional[str] = None
    text_body: Optional[str] = None
    from_name: Optional[str] = None
    reply_to: Optional[str] = None

class PreviewRequest(BaseModel):
    subject: str
    html_body: str
    variables: Dict[str, Any] = {}

class SuppressionCreate(BaseModel):
    email: str
    reason: str = "unsubscribed"
    notes: Optional[str] = None


# ── 1. Download Excel Template ──

@router.get("/template")
async def download_template():
    """
    Generates and downloads a real .xlsx recipient template workbook
    containing 'Recipients' and 'Instructions' sheets.
    """
    file_bytes = generate_recipient_template()
    return RawResponse(
        content=file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": "attachment; filename=UNAI_Flow_Email_Recipients_Template.xlsx",
            "Cache-Control": "no-cache",
        },
    )


# ── 2. Parse & Validate Recipient Spreadsheet ──

@router.post("/parse-recipients")
async def parse_recipients(
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(verify_jwt),
):
    """
    Authoritative server-side spreadsheet parsing and email validation.
    Performs RFC validation, deduplication, suppression checking, and returns
    summary counts and row-by-row previews.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    content = await file.read()
    try:
        result = await parse_recipient_spreadsheet(
            file_bytes=content,
            filename=file.filename,
            user_id=user["user_id"],
        )
        return {"success": True, "data": result}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"[EMAIL] Error parsing spreadsheet: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process spreadsheet: {str(e)}")


# ── 3. List User Campaigns ──

@router.get("")
async def list_campaigns(
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: Dict[str, Any] = Depends(verify_jwt),
):
    """Lists all email campaigns owned by the authenticated user."""
    query = (
        supabase.table("email_campaigns")
        .select("*")
        .eq("user_id", user["user_id"])
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if status and status != "all":
        query = query.eq("status", status)

    res = query.execute()
    return {"success": True, "campaigns": res.data or []}


# ── 4. Create Campaign (Draft or Immediate) ──

@router.post("")
async def create_campaign(
    payload: CampaignCreate,
    user: Dict[str, Any] = Depends(verify_jwt),
):
    """
    Creates a new email campaign. Can be saved as a draft or queued for sending.
    Also inserts the validated recipient records into email_recipients.
    """
    email_service = get_email_service()
    from_email = email_service.from_email
    from_name = payload.from_name or email_service.from_name

    recipients_list = payload.recipients or []
    total_recipients = len(recipients_list)
    initial_status = "queued" if payload.status == "queued" and total_recipients > 0 else "draft"

    campaign_data = {
        "user_id": user["user_id"],
        "name": payload.name,
        "subject": payload.subject,
        "from_email": from_email,
        "from_name": from_name,
        "reply_to": payload.reply_to or email_service.reply_to or None,
        "html_body": payload.html_body,
        "text_body": payload.text_body or email_service.html_to_plain_text(payload.html_body),
        "status": initial_status,
        "total_recipients": total_recipients,
        "queued_count": total_recipients if initial_status == "queued" else 0,
        "sent_count": 0,
        "delivered_count": 0,
        "failed_count": 0,
        "bounced_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "started_at": datetime.now(timezone.utc).isoformat() if initial_status == "queued" else None,
    }

    try:
        c_res = supabase.table("email_campaigns").insert(campaign_data).execute()
        if not c_res.data:
            raise HTTPException(status_code=500, detail="Failed to save campaign record.")

        created_campaign = c_res.data[0]
        campaign_id = created_campaign["id"]

        # Insert recipient records
        if recipients_list:
            recipient_rows = []
            for r in recipients_list:
                email_clean = str(r.get("email", "")).strip().lower()
                if not email_clean:
                    continue
                recipient_rows.append({
                    "campaign_id": campaign_id,
                    "user_id": user["user_id"],
                    "email": email_clean,
                    "name": r.get("name") or None,
                    "status": "queued" if initial_status == "queued" else "pending",
                    "variables": r.get("variables") or {"name": r.get("name") or ""},
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })

            # Bulk insert in chunks of 500
            for chunk_start in range(0, len(recipient_rows), 500):
                chunk = recipient_rows[chunk_start : chunk_start + 500]
                supabase.table("email_recipients").insert(chunk).execute()

        # Wake worker if queued
        if initial_status == "queued":
            email_worker.trigger()

        return {"success": True, "campaign": created_campaign}

    except Exception as e:
        logger.error(f"[EMAIL] Create campaign error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create campaign: {str(e)}")


# ── 5. Get Campaign Details ──

@router.get("/{campaign_id}")
async def get_campaign(
    campaign_id: str,
    user: Dict[str, Any] = Depends(verify_jwt),
):
    """Retrieves single campaign details and delivery statistics."""
    res = (
        supabase.table("email_campaigns")
        .select("*")
        .eq("id", campaign_id)
        .eq("user_id", user["user_id"])
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Campaign not found.")

    return {"success": True, "campaign": res.data[0]}


# ── 6. Update Campaign Draft ──

@router.patch("/{campaign_id}")
async def update_campaign(
    campaign_id: str,
    payload: CampaignUpdate,
    user: Dict[str, Any] = Depends(verify_jwt),
):
    """Updates a draft email campaign."""
    existing = (
        supabase.table("email_campaigns")
        .select("status")
        .eq("id", campaign_id)
        .eq("user_id", user["user_id"])
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Campaign not found.")

    if existing.data[0]["status"] not in ("draft", "cancelled"):
        raise HTTPException(status_code=400, detail="Cannot edit an in-progress or completed campaign.")

    update_fields = {k: v for k, v in payload.model_dump().items() if v is not None}
    update_fields["updated_at"] = datetime.now(timezone.utc).isoformat()

    res = (
        supabase.table("email_campaigns")
        .update(update_fields)
        .eq("id", campaign_id)
        .eq("user_id", user["user_id"])
        .execute()
    )
    return {"success": True, "campaign": res.data[0] if res.data else None}


# ── 7. Delete Campaign Draft ──

@router.delete("/{campaign_id}")
async def delete_campaign(
    campaign_id: str,
    user: Dict[str, Any] = Depends(verify_jwt),
):
    """Deletes an email campaign and its recipient records."""
    existing = (
        supabase.table("email_campaigns")
        .select("status")
        .eq("id", campaign_id)
        .eq("user_id", user["user_id"])
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Campaign not found.")

    if existing.data[0]["status"] in ("queued", "sending"):
        raise HTTPException(status_code=400, detail="Cannot delete an active sending campaign. Cancel it first.")

    supabase.table("email_campaigns").delete().eq("id", campaign_id).eq("user_id", user["user_id"]).execute()
    return {"success": True, "message": "Campaign deleted successfully."}


# ── 8. List Campaign Recipients ──

@router.get("/{campaign_id}/recipients")
async def list_recipients(
    campaign_id: str,
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: Dict[str, Any] = Depends(verify_jwt),
):
    """Retrieves paginated recipient delivery records for a campaign."""
    # Verify campaign ownership
    c_check = (
        supabase.table("email_campaigns")
        .select("id")
        .eq("id", campaign_id)
        .eq("user_id", user["user_id"])
        .limit(1)
        .execute()
    )
    if not c_check.data:
        raise HTTPException(status_code=404, detail="Campaign not found.")

    query = (
        supabase.table("email_recipients")
        .select("*")
        .eq("campaign_id", campaign_id)
        .order("created_at", desc=False)
        .range(offset, offset + limit - 1)
    )
    if status and status != "all":
        query = query.eq("status", status)

    res = query.execute()
    return {"success": True, "recipients": res.data or []}


# ── 9. Send Campaign ──

@router.post("/{campaign_id}/send")
async def send_campaign(
    campaign_id: str,
    user: Dict[str, Any] = Depends(verify_jwt),
):
    """
    Transitions a draft campaign into 'queued' status and enqueues all pending recipients
    for the background worker. Requires explicit confirmation from the client.
    """
    c_res = (
        supabase.table("email_campaigns")
        .select("*")
        .eq("id", campaign_id)
        .eq("user_id", user["user_id"])
        .limit(1)
        .execute()
    )
    if not c_res.data:
        raise HTTPException(status_code=404, detail="Campaign not found.")

    campaign = c_res.data[0]
    if campaign["status"] in ("sending", "queued"):
        raise HTTPException(status_code=400, detail="Campaign is already active.")

    if campaign["total_recipients"] == 0:
        raise HTTPException(status_code=400, detail="Campaign has no recipients. Upload a contact spreadsheet first.")

    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Enqueue all pending recipients
    supabase.table("email_recipients").update({
        "status": "queued",
        "updated_at": now_iso,
    }).eq("campaign_id", campaign_id).in_("status", ["pending", "failed"]).execute()

    # 2. Count queued recipients
    count_res = (
        supabase.table("email_recipients")
        .select("id")
        .eq("campaign_id", campaign_id)
        .eq("status", "queued")
        .execute()
    )
    queued_count = len(count_res.data or [])

    # 3. Update campaign status
    supabase.table("email_campaigns").update({
        "status": "queued",
        "queued_count": queued_count,
        "started_at": now_iso,
        "updated_at": now_iso,
    }).eq("id", campaign_id).execute()

    # 4. Trigger the background worker immediately
    email_worker.trigger()

    return {
        "success": True,
        "campaign_id": campaign_id,
        "status": "queued",
        "recipient_count": queued_count,
    }


# ── 10. Retry Failed Emails ──

@router.post("/{campaign_id}/retry-failed")
async def retry_failed(
    campaign_id: str,
    user: Dict[str, Any] = Depends(verify_jwt),
):
    """
    Safely re-enqueues only transiently failed recipients for a campaign.
    Idempotent and skips permanent bounces/suppressions.
    """
    c_res = (
        supabase.table("email_campaigns")
        .select("id, status")
        .eq("id", campaign_id)
        .eq("user_id", user["user_id"])
        .limit(1)
        .execute()
    )
    if not c_res.data:
        raise HTTPException(status_code=404, detail="Campaign not found.")

    now_iso = datetime.now(timezone.utc).isoformat()

    # Re-queue failed recipients
    res = (
        supabase.table("email_recipients")
        .update({
            "status": "queued",
            "error_message": None,
            "updated_at": now_iso,
        })
        .eq("campaign_id", campaign_id)
        .eq("status", "failed")
        .execute()
    )
    requeued_count = len(res.data or [])

    if requeued_count > 0:
        supabase.table("email_campaigns").update({
            "status": "queued",
            "queued_count": requeued_count,
            "updated_at": now_iso,
        }).eq("id", campaign_id).execute()

        email_worker.trigger()

    return {"success": True, "requeued_count": requeued_count}


# ── 11. Cancel In-Progress Campaign ──

@router.post("/{campaign_id}/cancel")
async def cancel_campaign(
    campaign_id: str,
    user: Dict[str, Any] = Depends(verify_jwt),
):
    """Cancels queued sending for an active campaign."""
    c_res = (
        supabase.table("email_campaigns")
        .select("id, status")
        .eq("id", campaign_id)
        .eq("user_id", user["user_id"])
        .limit(1)
        .execute()
    )
    if not c_res.data:
        raise HTTPException(status_code=404, detail="Campaign not found.")

    now_iso = datetime.now(timezone.utc).isoformat()

    # Cancel queued recipients
    supabase.table("email_recipients").update({
        "status": "cancelled",
        "updated_at": now_iso,
    }).eq("campaign_id", campaign_id).eq("status", "queued").execute()

    # Mark campaign cancelled
    supabase.table("email_campaigns").update({
        "status": "cancelled",
        "queued_count": 0,
        "completed_at": now_iso,
        "updated_at": now_iso,
    }).eq("id", campaign_id).execute()

    return {"success": True, "status": "cancelled"}


# ── 12. Render Personalized Preview ──

@router.post("/preview")
async def preview_email(payload: PreviewRequest):
    """
    Renders the exact personalized subject and HTML body using the same server-side
    engine as production sending, ensuring zero discrepancies.
    """
    email_service = get_email_service()
    variables = payload.variables or {}
    name_val = variables.get("name") or "there"

    personalized_subject = email_service.personalize(payload.subject, variables, default_name=name_val)
    personalized_html = email_service.personalize(payload.html_body, variables, default_name=name_val)
    safe_html = email_service.sanitize_html(personalized_html)
    plain_text = email_service.html_to_plain_text(safe_html)

    return {
        "success": True,
        "subject": personalized_subject,
        "html": safe_html,
        "text": plain_text,
    }


# ── 13. Suppressions Management ──

@router.get("/suppressions")
async def list_suppressions(user: Dict[str, Any] = Depends(verify_jwt)):
    """Lists all suppressed contacts for the authenticated user."""
    res = (
        supabase.table("email_suppressions")
        .select("*")
        .eq("user_id", user["user_id"])
        .order("created_at", desc=True)
        .execute()
    )
    return {"success": True, "suppressions": res.data or []}

@router.post("/suppressions")
async def add_suppression(payload: SuppressionCreate, user: Dict[str, Any] = Depends(verify_jwt)):
    """Manually adds an email to the suppression list."""
    email_service = get_email_service()
    await email_service.add_suppression(
        user_id=user["user_id"],
        email=payload.email,
        reason=payload.reason,
        notes=payload.notes or "Manually added",
    )
    return {"success": True, "message": f"{payload.email} added to suppression list."}

@router.delete("/suppressions/{email}")
async def remove_suppression(email: str, user: Dict[str, Any] = Depends(verify_jwt)):
    """Removes an email from the suppression list."""
    supabase.table("email_suppressions").delete().eq("user_id", user["user_id"]).eq("email", email.strip().lower()).execute()
    return {"success": True, "message": f"{email} removed from suppression list."}
