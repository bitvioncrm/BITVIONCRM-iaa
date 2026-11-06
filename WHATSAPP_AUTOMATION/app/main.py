from __future__ import annotations

import asyncio
import time
import uuid
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware

from app import accounts, anti_block, campaigns, config, crm, excel_import, projects, store, waha_client

app = FastAPI(title="WhatsApp Automation", version="2.2.0")
store.seed_if_empty()
projects.ensure_seed()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class FrameEmbedMiddleware(BaseHTTPMiddleware):
    """Allow embedding inside BITVION CRM iframe."""

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["Content-Security-Policy"] = "frame-ancestors *"
        if "x-frame-options" in response.headers:
            del response.headers["x-frame-options"]
        return response


app.add_middleware(FrameEmbedMiddleware)

_admin_cache: dict[str, tuple[float, bool]] = {}


async def _token_is_admin(token: str) -> bool:
    now = time.time()
    hit = _admin_cache.get(token)
    if hit and hit[0] > now:
        return hit[1]
    ok = False
    try:
        async with httpx.AsyncClient(timeout=20, verify=False) as client:
            user = await client.get(
                f"{config.SUPABASE_URL}/auth/v1/user",
                headers={
                    "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {token}",
                },
            )
            if user.status_code == 200:
                uid = str((user.json() or {}).get("id") or "")
                roles = await client.get(
                    f"{config.SUPABASE_URL}/rest/v1/user_roles",
                    headers={
                        "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
                        "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
                    },
                    params={"select": "roles(key)", "user_id": f"eq.{uid}"},
                )
                if roles.status_code == 200:
                    for row in roles.json() or []:
                        role = row.get("roles")
                        keys = []
                        if isinstance(role, list):
                            keys = [item.get("key") for item in role if isinstance(item, dict)]
                        elif isinstance(role, dict):
                            keys = [role.get("key")]
                        if any(key in ("admin", "super_admin") for key in keys):
                            ok = True
                            break
    except Exception:  # noqa: BLE001
        ok = False
    _admin_cache[token] = (now + 60, ok)
    return ok


class AdminWriteMiddleware(BaseHTTPMiddleware):
    """Bulk send, connect, and contact changes are admin-only."""

    async def dispatch(self, request: Request, call_next):
        if request.method in ("GET", "HEAD", "OPTIONS") or not request.url.path.startswith("/api/"):
            return await call_next(request)
        auth = request.headers.get("authorization") or ""
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        if not token or not await _token_is_admin(token):
            return JSONResponse({"detail": "Bulk messaging is limited to Admin."}, status_code=403)
        return await call_next(request)


app.add_middleware(AdminWriteMiddleware)

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/posters", StaticFiles(directory=str(config.POSTERS_DIR)), name="posters")


class FilterBody(BaseModel):
    statuses: list[str] = Field(default_factory=list)
    date_from: str | None = None
    date_to: str | None = None
    search: str | None = None
    reminder_only: bool = False
    source: str | None = None  # crm | excel | whatsapp | all
    workspace_id: str | None = None
    project_id: str | None = None


class ProjectCreate(BaseModel):
    name: str = "New Project"
    workspace_id: str | None = None
    auto_sync_crm: bool = True
    auto_sync_wa: bool = True
    activate: bool = True
    bootstrap: bool = True  # auto-fetch CRM + WA right after create


class ProjectUpdate(BaseModel):
    name: str | None = None
    workspace_id: str | None = None
    auto_sync_crm: bool | None = None
    auto_sync_wa: bool | None = None


class CampaignCreate(BaseModel):
    name: str = "Campaign"
    kind: str = "bulk"
    message: str = ""
    poster: str | None = None
    statuses: list[str] = Field(default_factory=list)
    date_from: str | None = None
    date_to: str | None = None
    search: str | None = None
    reminder_only: bool = False
    source: str | None = None
    workspace_id: str | None = None
    lead_ids: list[str] | None = None
    dry_run: bool = False
    scheduled_at: str | None = None
    session: str | None = None


class AccountCreate(BaseModel):
    label: str = "WhatsApp"


class TemplateCreate(BaseModel):
    name: str
    body: str
    kind: str = "bulk"


class TemplateUpdate(BaseModel):
    name: str | None = None
    body: str | None = None
    kind: str | None = None


class CampaignUpdate(BaseModel):
    name: str | None = None
    message: str | None = None
    poster: str | None = None
    scheduled_at: str | None = None


class LeadCreate(BaseModel):
    full_name: str = "Lead"
    phone: str
    status: str = "new"
    source: str = "manual"
    notes: str = ""
    origin: str = "manual"
    workspace_id: str | None = None
    next_follow_up_at: str | None = None


class LeadUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    status: str | None = None
    source: str | None = None
    notes: str | None = None
    next_follow_up_at: str | None = None


def _me_phone(me: object) -> str:
    if not isinstance(me, dict):
        return ""
    return str(me.get("id") or me.get("phone") or "").split("@")[0]


def _requested_session(request: Request) -> str:
    return (request.query_params.get("session") or accounts.active_id() or "default").strip()


async def _account_rows() -> list[dict]:
    saved = accounts.list_accounts()
    live: dict[str, dict] = {}
    try:
        remote = await asyncio.wait_for(waha_client.list_sessions(), timeout=4)
        for row in remote:
            if isinstance(row, dict) and row.get("name"):
                live[str(row["name"])] = row
    except Exception:  # noqa: BLE001
        live = {}
    active = accounts.active_id()
    out = []
    for item in saved:
        row = live.get(item["id"]) or {}
        me = row.get("me") or {}
        out.append(
            {
                "id": item["id"],
                "label": item.get("label") or item["id"],
                "status": row.get("status") or "OFFLINE",
                "phone": _me_phone(me),
                "push_name": me.get("pushName") if isinstance(me, dict) else "",
                "active": item["id"] == active,
            }
        )
    return out


def _apply_source_filter(rows: list[dict], source: str | None) -> list[dict]:
    if not source or source == "all":
        return rows
    if source == "excel":
        return [r for r in rows if r.get("origin") == "excel" or r.get("status") == "excel" or r.get("source") == "excel"]
    if source == "crm":
        return [r for r in rows if r.get("origin") == "crm"]
    if source == "whatsapp":
        return [r for r in rows if r.get("origin") == "whatsapp" or r.get("status") == "whatsapp_contact"]
    return rows


@app.get("/")
async def home():
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/health")
async def health():
    rows = await _account_rows()
    active = next((row for row in rows if row.get("active")), rows[0] if rows else None)
    session = {"status": "UNKNOWN", "me": {}}
    if active:
        try:
            session = await asyncio.wait_for(waha_client.session_info(active["id"]), timeout=4)
        except Exception as exc:  # noqa: BLE001
            session = {"status": active.get("status") or "OFFLINE", "me": {}, "error": str(exc)}
    me = session.get("me") or {}
    connected = sum(1 for row in rows if row.get("status") == "WORKING")
    return {
        "ok": True,
        "waha": session.get("status"),
        "me": me,
        "phone": _me_phone(me) or (active or {}).get("phone") or "",
        "session": (active or {}).get("id"),
        "accounts": rows,
        "connected": connected,
        "crm": "connected" if crm.crm_configured() else "not_configured",
        "anti_block": anti_block.caps_snapshot(),
    }


@app.get("/api/accounts")
async def get_accounts():
    return {"active": accounts.active_id(), "accounts": await _account_rows()}


@app.post("/api/accounts")
async def create_account(body: AccountCreate):
    row = accounts.add_account(body.label)
    status = "OFFLINE"
    error = None
    try:
        info = await waha_client.ensure_session(session=row["id"])
        status = info.get("status") or status
    except Exception as exc:  # noqa: BLE001
        error = str(exc)
    return {"account": row, "status": status, "error": error, "accounts": await _account_rows()}


@app.post("/api/accounts/{session_id}/activate")
async def activate_account(session_id: str):
    row = accounts.set_active(session_id)
    if not row:
        raise HTTPException(404, "WhatsApp number not found")
    return {"active": session_id, "accounts": await _account_rows()}


def _clear_connected_contacts(session_id: str, live_rows: list[dict]) -> int:
    others_connected = any(
        row.get("id") != session_id and row.get("status") == "WORKING" for row in live_rows
    )
    target = next((row for row in live_rows if row.get("id") == session_id), {})
    include_untagged = target.get("status") == "WORKING" or not others_connected
    removed = store.clear_whatsapp_contacts(session_id, include_untagged=include_untagged)
    left = sum(
        1
        for row in store.list_leads()
        if row.get("origin") == "whatsapp" or row.get("status") == "whatsapp_contact"
    )
    for project in projects.list_projects():
        if project.get("id"):
            projects.update_project(project["id"], {"wa_count": left})
    return removed


@app.delete("/api/accounts/{session_id}")
async def delete_account(session_id: str):
    if session_id not in {row["id"] for row in accounts.list_accounts()}:
        raise HTTPException(404, "WhatsApp number not found")
    live = await _account_rows()
    removed = _clear_connected_contacts(session_id, live)
    try:
        await waha_client.delete_session(session_id)
    except Exception:  # noqa: BLE001
        pass
    if len(accounts.list_accounts()) <= 1:
        return {
            "ok": True,
            "kept_slot": True,
            "contacts_removed": removed,
            "accounts": await _account_rows(),
        }
    if not accounts.remove_account(session_id):
        raise HTTPException(400, "Could not remove this WhatsApp")
    return {"ok": True, "contacts_removed": removed, "accounts": await _account_rows()}


@app.post("/api/session/start")
async def session_start(request: Request):
    name = _requested_session(request)
    force = request.query_params.get("force") in ("1", "true", "yes")
    try:
        info = await waha_client.ensure_session(session=name, force_reset=force)
        return {"ok": True, "session": info, "status": info.get("status")}
    except Exception as exc:  # noqa: BLE001
        # Never hard-fail the UI — return current status so QR poll can continue
        try:
            info = await waha_client.session_info(name)
            return {
                "ok": False,
                "session": info,
                "status": info.get("status"),
                "error": str(exc),
            }
        except Exception:  # noqa: BLE001
            raise HTTPException(502, f"Could not start WhatsApp session: {exc}") from exc


@app.get("/api/session/status")
async def session_status(request: Request):
    """Lightweight status poll — does not regenerate QR."""
    name = _requested_session(request)
    try:
        info = await waha_client.session_info(name)
    except Exception as exc:  # noqa: BLE001
        return {"status": "ERROR", "error": str(exc), "me": None, "engine": {}, "session": name}
    me = info.get("me") or {}
    engine = info.get("engine") or {}
    return {
        "status": info.get("status"),
        "session": name,
        "me": me,
        "phone": _me_phone(me),
        "engine": engine,
        "engine_state": engine.get("state") if isinstance(engine, dict) else None,
    }


@app.get("/api/session/qr")
async def session_qr(request: Request):
    """Fetch QR image. Pass ?fresh=1 only when user clicks Refresh (regenerates code)."""
    name = _requested_session(request)
    fresh = request.query_params.get("fresh") in ("1", "true", "yes")
    try:
        data = await waha_client.get_qr(session=name, restart_if_failed=True, force_fresh=fresh)
        data["session"] = name
        return data
    except Exception as exc:  # noqa: BLE001
        try:
            info = await waha_client.session_info(name)
            return {
                "status": info.get("status") or "ERROR",
                "qr": None,
                "me": info.get("me"),
                "session": name,
                "error": str(exc),
            }
        except Exception:  # noqa: BLE001
            return {
                "status": "OFFLINE",
                "qr": None,
                "me": None,
                "session": name,
                "error": "WhatsApp engine is not running. Start it, then scan this number.",
            }


@app.post("/api/session/logout")
async def session_logout(request: Request):
    name = _requested_session(request)
    live = await _account_rows()
    removed = _clear_connected_contacts(name, live)
    try:
        result = await waha_client.logout_session(name)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Logout failed: {exc}") from exc
    result["contacts_removed"] = removed
    return result


async def _sync_wa_for_project(project: dict | None) -> dict:
    name = accounts.active_id()
    session = await waha_client.session_info(name)
    if session.get("status") != "WORKING":
        return {
            "ok": False,
            "synced": 0,
            "status": session.get("status"),
            "error": f"WhatsApp is {session.get('status')}",
        }
    contacts = await waha_client.list_contacts(limit=2000, session=name)
    pid = (project or {}).get("id")
    for c in contacts:
        c["wa_session"] = name
        if pid:
            c["project_id"] = pid
    added = store.upsert_leads(contacts) if contacts else 0
    if project and pid:
        projects.update_project(
            pid,
            {
                "last_wa_sync_at": projects.now(),
                "wa_count": len(contacts),
            },
        )
    return {"ok": True, "synced": len(contacts), "upserted": added, "contacts": contacts[:50]}


async def _sync_crm_for_project(project: dict | None) -> dict:
    if not crm.crm_configured():
        return {"ok": False, "synced": 0, "error": "CRM not configured"}
    workspace_id = (project or {}).get("workspace_id") or config.CRM_WORKSPACE_ID or None
    rows = await crm.fetch_all_leads(
        statuses=None,
        date_from=None,
        date_to=None,
        search=None,
        reminder_only=False,
        workspace_id=workspace_id,
    )
    pid = (project or {}).get("id")
    count = store.replace_with_crm_leads(rows, project_id=pid)
    if project and pid:
        projects.update_project(
            pid,
            {
                "last_crm_sync_at": projects.now(),
                "crm_count": count,
            },
        )
    return {"ok": True, "synced": count, "workspace_id": workspace_id}


async def bootstrap_project(project: dict) -> dict:
    """Auto-fetch CRM + WhatsApp for a project (best-effort)."""
    result = {"project_id": project.get("id"), "crm": None, "whatsapp": None}
    if project.get("auto_sync_crm", True):
        try:
            result["crm"] = await _sync_crm_for_project(project)
        except Exception as exc:  # noqa: BLE001
            result["crm"] = {"ok": False, "synced": 0, "error": str(exc)}
    if project.get("auto_sync_wa", True):
        try:
            result["whatsapp"] = await _sync_wa_for_project(project)
        except Exception as exc:  # noqa: BLE001
            result["whatsapp"] = {"ok": False, "synced": 0, "error": str(exc)}
    result["project"] = projects.get_project(project["id"])
    return result


@app.get("/api/projects")
async def get_projects():
    return projects.snapshot()


@app.post("/api/projects")
async def create_project(body: ProjectCreate):
    item = projects.create_project(
        name=body.name,
        workspace_id=body.workspace_id,
        auto_sync_crm=body.auto_sync_crm,
        auto_sync_wa=body.auto_sync_wa,
        activate=body.activate,
    )
    boot = None
    if body.bootstrap:
        boot = await bootstrap_project(item)
    return {"project": projects.get_project(item["id"]) or item, "bootstrap": boot}


@app.patch("/api/projects/{project_id}")
async def patch_project(project_id: str, body: ProjectUpdate):
    row = projects.update_project(project_id, body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(404, "Project not found")
    return row


@app.post("/api/projects/{project_id}/activate")
async def activate_project(project_id: str, request: Request):
    row = projects.set_active(project_id)
    if not row:
        raise HTTPException(404, "Project not found")
    bootstrap = request.query_params.get("bootstrap", "1") not in ("0", "false", "no")
    boot = await bootstrap_project(row) if bootstrap else None
    return {"project": projects.get_project(project_id), "bootstrap": boot}


@app.post("/api/projects/{project_id}/sync")
async def sync_project(project_id: str):
    row = projects.get_project(project_id)
    if not row:
        raise HTTPException(404, "Project not found")
    projects.set_active(project_id)
    return await bootstrap_project(row)


@app.delete("/api/projects/{project_id}")
async def remove_project(project_id: str):
    if not projects.delete_project(project_id):
        raise HTTPException(400, "Cannot delete the only project (or not found)")
    return {"ok": True, **projects.snapshot()}


@app.post("/api/contacts/sync")
async def contacts_sync():
    try:
        session = await waha_client.session_info(accounts.active_id())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"WhatsApp unreachable: {exc}") from exc
    if session.get("status") != "WORKING":
        raise HTTPException(
            400,
            f"WhatsApp is {session.get('status')}. Open Scan & Connect and scan QR first.",
        )
    active = projects.get_active()
    try:
        result = await _sync_wa_for_project(active)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not fetch contacts: {exc}") from exc
    if not result.get("synced"):
        raise HTTPException(
            400,
            result.get("error") or "No WhatsApp contacts found yet. Open WhatsApp chats, then Sync again.",
        )
    stages = store.stage_counts()
    return {
        **result,
        "whatsapp_contacts": stages.get("whatsapp_contact", 0),
        "project_id": (active or {}).get("id"),
    }


@app.get("/api/meta")
async def meta():
    workspaces = []
    try:
        workspaces = await crm.list_workspaces()
    except Exception:  # noqa: BLE001
        workspaces = []
    return {
        "statuses": config.LEAD_STATUSES,
        "status_labels": config.STATUS_LABELS,
        "delay_min": config.BULK_DELAY_MIN,
        "delay_max": config.BULK_DELAY_MAX,
        "session": config.WAHA_SESSION,
        "crm": crm.crm_configured(),
        "workspaces": workspaces,
        "anti_block": anti_block.caps_snapshot(),
        "projects": projects.snapshot(),
    }


@app.get("/api/analytics")
async def analytics():
    leads = store.list_leads()
    stats = store.campaign_analytics()
    stages = store.stage_counts()
    return {
        "total_leads": len(leads),
        "by_status": stages,
        "stage_counts": stages,
        "whatsapp_contacts": stages.get("whatsapp_contact", 0),
        "excel_leads": stages.get("excel", 0),
        "crm_leads": sum(1 for r in leads if r.get("origin") == "crm"),
        **stats,
        "anti_block": anti_block.caps_snapshot(),
    }


@app.post("/api/crm/sync")
async def sync_crm(body: FilterBody):
    if not crm.crm_configured():
        raise HTTPException(400, "CRM is not configured in .env")
    active = projects.get_active()
    workspace_id = body.workspace_id or (active or {}).get("workspace_id") or config.CRM_WORKSPACE_ID or None
    try:
        result = await _sync_crm_for_project(
            {
                **(active or {}),
                "workspace_id": workspace_id,
                "id": body.project_id or (active or {}).get("id"),
            }
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"CRM sync failed: {exc}") from exc
    return {
        "synced": result.get("synced", 0),
        "total_local": len(store.list_leads()),
        "project_id": body.project_id or (active or {}).get("id"),
        "workspace_id": workspace_id,
    }


@app.post("/api/leads/query")
async def leads_query(body: FilterBody):
    # Fast path: local snapshot only. Return 50 preview rows (UI shows 50).
    rows = store.list_leads(
        statuses=body.statuses or None,
        date_from=body.date_from,
        date_to=body.date_to,
        search=body.search,
        reminder_only=body.reminder_only,
    )
    rows = _apply_source_filter(rows, body.source)
    active = projects.get_active()
    project_id = body.project_id or (active or {}).get("id")
    workspace_id = body.workspace_id or (active or {}).get("workspace_id")
    if project_id:
        rows = store.filter_by_project(rows, project_id)
    if workspace_id:
        rows = [r for r in rows if not r.get("workspace_id") or r.get("workspace_id") == workspace_id]

    by_status: dict[str, int] = {}
    for row in rows:
        st = row.get("status") or "unknown"
        by_status[st] = by_status.get(st, 0) + 1

    stage_totals = store.stage_counts(source=body.source, workspace_id=body.workspace_id)
    preview = [
        {
            "id": r.get("id"),
            "full_name": r.get("full_name"),
            "phone": r.get("phone"),
            "status": r.get("status"),
            "origin": r.get("origin"),
            "source": r.get("source"),
            "workspace_id": r.get("workspace_id"),
        }
        for r in rows[:50]
    ]
    return {
        "count": len(rows),
        "stats": {"total": len(rows), "by_status": by_status},
        "stage_counts": stage_totals,
        "leads": preview,
        "truncated": len(rows) > 50,
        "source_mode": body.source or "all",
        "live_crm": False,
        "cached": True,
    }


@app.post("/api/leads/import")
async def import_leads(file: UploadFile = File(...)):
    raw = await file.read()
    name = (file.filename or "").lower()
    try:
        if name.endswith(".xlsx") or name.endswith(".xlsm"):
            rows = excel_import.rows_from_excel_bytes(raw)
        else:
            rows = excel_import.rows_from_csv_bytes(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Could not read file: {exc}") from exc
    added = store.import_leads_rows(rows, default_status="excel", source="excel")
    return {"imported": added, "stage": "excel"}


@app.post("/api/leads/import-csv")
async def import_csv(file: UploadFile = File(...)):
    return await import_leads(file)


@app.get("/api/templates")
async def get_templates():
    return {"templates": store.list_templates()}


@app.post("/api/templates")
async def create_template(body: TemplateCreate):
    return store.save_template(body.name, body.body, body.kind)


@app.put("/api/templates/{template_id}")
async def update_template(template_id: str, body: TemplateUpdate):
    row = store.update_template(
        template_id,
        name=body.name,
        body=body.body,
        kind=body.kind,
    )
    if not row:
        raise HTTPException(404, "Template not found")
    return row


@app.delete("/api/templates/{template_id}")
async def delete_template(template_id: str):
    if not store.delete_template(template_id):
        raise HTTPException(404, "Template not found")
    return {"ok": True, "id": template_id}


@app.post("/api/leads")
async def create_lead(body: LeadCreate):
    try:
        return store.create_lead(body.model_dump())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.put("/api/leads/{lead_id}")
async def update_lead(lead_id: str, body: LeadUpdate):
    row = store.update_lead(lead_id, body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(404, "Lead not found")
    return row


@app.delete("/api/leads/{lead_id}")
async def delete_lead(lead_id: str):
    if not store.delete_lead(lead_id):
        raise HTTPException(404, "Lead not found")
    return {"ok": True, "id": lead_id}


@app.get("/api/posters")
async def list_posters():
    files = []
    for path in sorted(config.POSTERS_DIR.glob("*")):
        if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            files.append({"name": path.name, "url": f"/posters/{path.name}"})
    return {"posters": files}


@app.post("/api/posters")
async def upload_poster(file: UploadFile = File(...)):
    suffix = Path(file.filename or "poster.jpg").suffix.lower() or ".jpg"
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        raise HTTPException(400, "Only image files allowed")
    name = f"{uuid.uuid4().hex[:10]}{suffix}"
    dest = config.POSTERS_DIR / name
    dest.write_bytes(await file.read())
    return {"name": name, "url": f"/posters/{name}"}


@app.delete("/api/posters/{poster_name}")
async def delete_poster(poster_name: str):
    path = config.POSTERS_DIR / Path(poster_name).name
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "Poster not found")
    path.unlink()
    return {"ok": True, "name": path.name}


def _slim_campaign(row: dict, *, include_logs: bool = False) -> dict:
    out = {k: v for k, v in row.items() if k not in ("leads_snapshot", "logs", "lead_ids")}
    out["total"] = row.get("total") or len(row.get("lead_ids") or [])
    out["has_leads"] = bool(row.get("lead_ids"))
    if include_logs:
        out["logs"] = (row.get("logs") or [])[-50:]
        out["lead_ids_count"] = len(row.get("lead_ids") or [])
    return out


@app.get("/api/campaigns")
async def get_campaigns():
    return {"campaigns": [_slim_campaign(c) for c in store.list_campaigns()[:100]]}


@app.get("/api/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str):
    row = store.get_campaign(campaign_id)
    if not row:
        raise HTTPException(404, "Campaign not found")
    return _slim_campaign(row, include_logs=True)


@app.post("/api/campaigns")
async def create_campaign(body: CampaignCreate):
    filters = {
        "statuses": body.statuses,
        "date_from": body.date_from,
        "date_to": body.date_to,
        "search": body.search,
        "reminder_only": body.reminder_only or body.kind == "reminder",
        "source": body.source,
        "workspace_id": body.workspace_id,
    }

    # Fast path: always use local cache (filled by CRM sync / Excel / WA contacts).
    # Avoid re-downloading 12k CRM rows on every Preview/Send click.
    local_rows = store.list_leads(
        statuses=body.statuses or None,
        date_from=body.date_from,
        date_to=body.date_to,
        search=body.search,
        reminder_only=filters["reminder_only"],
    )
    if body.workspace_id:
        local_rows = [
            r for r in local_rows if not r.get("workspace_id") or r.get("workspace_id") == body.workspace_id
        ]

    if body.source == "excel":
        recipients = [
            r
            for r in local_rows
            if r.get("origin") == "excel" or r.get("status") == "excel" or r.get("source") == "excel"
        ]
    elif body.source == "whatsapp":
        recipients = [
            r for r in local_rows if r.get("origin") == "whatsapp" or r.get("status") == "whatsapp_contact"
        ]
    elif body.source == "crm":
        recipients = [r for r in local_rows if r.get("origin") == "crm"]
    else:
        recipients = list(local_rows)

    if body.lead_ids:
        wanted = set(body.lead_ids)
        recipients = [r for r in recipients if r["id"] in wanted]

    if not recipients:
        raise HTTPException(400, "No leads matched filters")
    if body.kind == "poster" and not body.poster:
        raise HTTPException(400, "Poster required for poster campaigns")

    if not body.dry_run:
        try:
            await waha_client.ensure_session(session=body.session or accounts.active_id())
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"Could not start WhatsApp: {exc}") from exc
        session = await waha_client.session_info(body.session or accounts.active_id())
        if session.get("status") != "WORKING":
            raise HTTPException(
                400,
                f"WhatsApp is {session.get('status')}. Open Scan & Connect and scan the QR code first.",
            )

    if not body.dry_run and not body.scheduled_at:
        ok_caps, reason = anti_block.can_send_more()
        if not ok_caps and "Outside business hours" not in reason and "Hourly" not in reason:
            raise HTTPException(429, reason)

    # Keep snapshot lean for speed (full phones still available via lead_ids + local store)
    if body.dry_run:
        snapshot = [
            {
                "id": r.get("id"),
                "full_name": r.get("full_name"),
                "phone": r.get("phone"),
                "status": r.get("status"),
            }
            for r in recipients[:20]
        ]
    else:
        snapshot = [
            {
                "id": r.get("id"),
                "full_name": r.get("full_name"),
                "phone": r.get("phone"),
                "status": r.get("status"),
                "workspace_id": r.get("workspace_id"),
            }
            for r in recipients
        ]

    # Dry-run: count only — skip persisting thousands of lead_ids for instant preview
    if body.dry_run:
        return {
            "id": "preview",
            "name": body.name or "Preview",
            "kind": body.kind,
            "status": "dry_run",
            "total": len(recipients),
            "sent": 0,
            "failed": 0,
            "has_leads": True,
            "filters": filters,
            "sample": snapshot,
        }

    campaign = store.create_campaign(
        name=body.name,
        kind=body.kind,
        message=body.message,
        poster=body.poster,
        lead_ids=[r["id"] for r in recipients],
        filters=filters,
        leads_snapshot=snapshot,
        scheduled_at=body.scheduled_at,
        session=body.session or accounts.active_id(),
    )

    campaigns.start_campaign_background(campaign["id"])
    return _slim_campaign(campaign)


@app.patch("/api/campaigns/{campaign_id}")
async def patch_campaign(campaign_id: str, body: CampaignUpdate):
    row = store.update_campaign(campaign_id, body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(404, "Campaign not found")
    return row


@app.delete("/api/campaigns/{campaign_id}")
async def remove_campaign(campaign_id: str):
    row = store.get_campaign(campaign_id)
    if not row:
        raise HTTPException(404, "Campaign not found")
    if row.get("status") in ("running", "cooling"):
        row["status"] = "cancelled"
        store.save_campaign(row)
    if not store.delete_campaign(campaign_id):
        raise HTTPException(404, "Campaign not found")
    return {"ok": True, "id": campaign_id}


@app.post("/api/campaigns/{campaign_id}/cancel")
async def cancel_campaign(campaign_id: str):
    row = store.get_campaign(campaign_id)
    if not row:
        raise HTTPException(404, "Campaign not found")
    row["status"] = "cancelled"
    store.save_campaign(row)
    return row


@app.post("/api/campaigns/{campaign_id}/resume")
async def resume_campaign(campaign_id: str):
    row = store.get_campaign(campaign_id)
    if not row:
        raise HTTPException(404, "Campaign not found")
    if row.get("status") not in ("paused", "scheduled", "queued"):
        raise HTTPException(400, f"Cannot resume status {row.get('status')}")
    progress = int(row.get("progress") or 0)
    ids = row.get("lead_ids") or []
    remaining = ids[progress:] if progress else ids
    if not remaining and row.get("status") != "scheduled":
        raise HTTPException(400, "No remaining recipients")
    if remaining and progress:
        # Keep original total; only re-queue unsent ids
        row["lead_ids"] = remaining
        row["progress"] = 0
    row["status"] = "queued"
    row["pause_reason"] = None
    row["finished_at"] = None
    store.save_campaign(row)
    campaigns.start_campaign_background(campaign_id)
    return row


@app.post("/api/test-send")
async def test_send(
    phone: str = Form(...),
    message: str = Form("Hello from Dr. K's Aesthetic Clinic"),
    poster: str | None = Form(None),
):
    name = accounts.active_id()
    session = await waha_client.session_info(name)
    if session.get("status") != "WORKING":
        raise HTTPException(400, f"Session is {session.get('status')}")
    if poster:
        path = config.POSTERS_DIR / Path(poster).name
        if not path.exists():
            raise HTTPException(404, "Poster not found")
        result = await waha_client.send_image(phone, path, caption=message, session=name)
    else:
        result = await waha_client.send_text(phone, message, session=name)
    return {"ok": True, "result": result}
