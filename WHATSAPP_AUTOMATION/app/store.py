from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app import config


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


_cache: dict[str, tuple[float, Any]] = {}


def _read(path: Path, default: Any):
    if not path.exists():
        return default
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return default
    key = str(path)
    hit = _cache.get(key)
    if hit and hit[0] == mtime:
        return hit[1]
    data = json.loads(path.read_text(encoding="utf-8"))
    _cache[key] = (mtime, data)
    return data


def _write(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        _cache[str(path)] = (path.stat().st_mtime, data)
    except OSError:
        _cache.pop(str(path), None)


def invalidate_cache() -> None:
    _cache.clear()


def seed_if_empty() -> None:
    if not config.LEADS_FILE.exists():
        _write(config.LEADS_FILE, [])

    if not config.TEMPLATES_FILE.exists():
        _write(
            config.TEMPLATES_FILE,
            [
                {
                    "id": "welcome",
                    "name": "Welcome",
                    "body": "Hi {name}, thank you for contacting Dr. K's Aesthetic Clinic. How can we help you today?",
                    "kind": "bulk",
                },
                {
                    "id": "followup",
                    "name": "Follow-up Reminder",
                    "body": "Hi {name}, this is a reminder from Dr. K's Aesthetic Clinic about your follow-up. Reply YES to continue.",
                    "kind": "reminder",
                },
                {
                    "id": "offer",
                    "name": "Offer Poster Caption",
                    "body": "Hi {name}, here is an update from Dr. K's Aesthetic Clinic.",
                    "kind": "poster",
                },
            ],
        )

    if not config.CAMPAIGNS_FILE.exists():
        _write(config.CAMPAIGNS_FILE, [])


def list_leads(
    statuses: list[str] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    search: str | None = None,
    reminder_only: bool = False,
) -> list[dict]:
    seed_if_empty()
    rows = _read(config.LEADS_FILE, [])
    out = []
    for row in rows:
        if statuses and row.get("status") not in statuses:
            continue
        created = row.get("created_at") or ""
        if date_from and created[:10] < date_from[:10]:
            continue
        if date_to and created[:10] > date_to[:10]:
            continue
        if reminder_only and not row.get("next_follow_up_at"):
            continue
        if search:
            q = search.lower()
            blob = f"{row.get('full_name','')} {row.get('phone','')} {row.get('status','')}".lower()
            if q not in blob:
                continue
        out.append(row)
    out.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return out


def lead_stats(filters: dict | None = None) -> dict:
    filters = filters or {}
    rows = list_leads(
        statuses=filters.get("statuses"),
        date_from=filters.get("date_from"),
        date_to=filters.get("date_to"),
        search=filters.get("search"),
        reminder_only=bool(filters.get("reminder_only")),
    )
    by_status: dict[str, int] = {}
    for row in rows:
        st = row.get("status") or "unknown"
        by_status[st] = by_status.get(st, 0) + 1
    return {"total": len(rows), "by_status": by_status}


def list_templates() -> list[dict]:
    seed_if_empty()
    return _read(config.TEMPLATES_FILE, [])


def save_template(name: str, body: str, kind: str = "bulk") -> dict:
    rows = list_templates()
    item = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "body": body,
        "kind": kind,
        "updated_at": _now(),
    }
    rows.append(item)
    _write(config.TEMPLATES_FILE, rows)
    return item


def get_template(template_id: str) -> dict | None:
    for row in list_templates():
        if row.get("id") == template_id:
            return row
    return None


def update_template(template_id: str, *, name: str | None = None, body: str | None = None, kind: str | None = None) -> dict | None:
    rows = list_templates()
    for i, row in enumerate(rows):
        if row.get("id") != template_id:
            continue
        if name is not None:
            row["name"] = name
        if body is not None:
            row["body"] = body
        if kind is not None:
            row["kind"] = kind
        row["updated_at"] = _now()
        rows[i] = row
        _write(config.TEMPLATES_FILE, rows)
        return row
    return None


def delete_template(template_id: str) -> bool:
    rows = list_templates()
    next_rows = [r for r in rows if r.get("id") != template_id]
    if len(next_rows) == len(rows):
        return False
    _write(config.TEMPLATES_FILE, next_rows)
    return True


def list_campaigns() -> list[dict]:
    seed_if_empty()
    rows = _read(config.CAMPAIGNS_FILE, [])
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return rows


def get_campaign(campaign_id: str) -> dict | None:
    for row in list_campaigns():
        if row.get("id") == campaign_id:
            return row
    return None


def save_campaign(campaign: dict) -> dict:
    rows = list_campaigns()
    found = False
    for i, row in enumerate(rows):
        if row.get("id") == campaign["id"]:
            rows[i] = campaign
            found = True
            break
    if not found:
        rows.insert(0, campaign)
    _write(config.CAMPAIGNS_FILE, rows)
    return campaign


def create_campaign(
    *,
    name: str,
    kind: str,
    message: str,
    poster: str | None,
    lead_ids: list[str],
    filters: dict,
    leads_snapshot: list[dict] | None = None,
    scheduled_at: str | None = None,
    session: str | None = None,
) -> dict:
    campaign = {
        "id": str(uuid.uuid4())[:10],
        "name": name,
        "kind": kind,
        "message": message,
        "poster": poster,
        "session": session,
        "lead_ids": lead_ids,
        "leads_snapshot": [
            {
                "id": r.get("id"),
                "full_name": r.get("full_name"),
                "phone": r.get("phone"),
                "status": r.get("status"),
                "workspace_id": r.get("workspace_id"),
            }
            for r in (leads_snapshot or [])
        ],
        "filters": filters,
        "status": "scheduled" if scheduled_at else "queued",
        "scheduled_at": scheduled_at,
        "created_at": _now(),
        "started_at": None,
        "finished_at": None,
        "pause_reason": None,
        "total": len(lead_ids),
        "sent": 0,
        "failed": 0,
        "skipped": 0,
        "delivered": 0,
        "read": 0,
        "logs": [],
    }
    return save_campaign(campaign)


def upsert_leads(rows: list[dict]) -> int:
    """Merge leads by phone without deleting the rest of the cache."""
    seed_if_empty()
    existing = _read(config.LEADS_FILE, [])
    by_phone = {"".join(c for c in str(r.get("phone") or "") if c.isdigit()): r for r in existing}
    for row in rows:
        phone = "".join(c for c in str(row.get("phone") or "") if c.isdigit())
        if not phone:
            continue
        clean = {**row, "phone": phone}
        if not clean.get("created_at"):
            clean["created_at"] = _now()
        if phone in by_phone:
            old = by_phone[phone]
            if old.get("origin") == "crm" or (old.get("workspace_id") and old.get("origin") != "whatsapp"):
                by_phone[phone] = old
                continue
            merged = {**old, **clean, "id": old.get("id") or clean.get("id")}
            # Keep original created_at if already present
            if old.get("created_at"):
                merged["created_at"] = old["created_at"]
            by_phone[phone] = merged
        else:
            by_phone[phone] = clean
    final = list(by_phone.values())
    _write(config.LEADS_FILE, final)
    return len(rows)


def _is_whatsapp_contact(row: dict) -> bool:
    return (
        row.get("origin") == "whatsapp"
        or row.get("status") == "whatsapp_contact"
        or row.get("source") == "whatsapp"
    )


def clear_whatsapp_contacts(session_id: str, *, include_untagged: bool = True) -> int:
    """Drop contacts imported from a WhatsApp number. CRM rows stay."""
    seed_if_empty()
    rows = _read(config.LEADS_FILE, [])
    kept: list[dict] = []
    removed = 0
    for row in rows:
        if not _is_whatsapp_contact(row):
            kept.append(row)
            continue
        if row.get("origin") == "crm" or (row.get("workspace_id") and row.get("origin") != "whatsapp"):
            kept.append(row)
            continue
        owner = row.get("wa_session")
        if owner and owner != session_id:
            kept.append(row)
            continue
        if not owner and not include_untagged:
            kept.append(row)
            continue
        removed += 1
    if removed:
        _write(config.LEADS_FILE, kept)
        invalidate_cache()
    return removed


def campaign_analytics() -> dict:
    rows = list_campaigns()
    total_sent = sum(int(c.get("sent") or 0) for c in rows)
    total_failed = sum(int(c.get("failed") or 0) for c in rows)
    total_delivered = sum(int(c.get("delivered") or c.get("sent") or 0) for c in rows)
    total_read = sum(int(c.get("read") or 0) for c in rows)
    active = sum(1 for c in rows if c.get("status") in ("queued", "running", "cooling", "paused", "scheduled"))
    scheduled = sum(1 for c in rows if c.get("status") == "scheduled")
    return {
        "messages_sent": total_sent,
        "failed": total_failed,
        "delivered": total_delivered,
        "read": total_read,
        "delivered_pct": round((total_delivered / total_sent) * 100, 1) if total_sent else 0,
        "read_pct": round((total_read / total_sent) * 100, 1) if total_sent else 0,
        "active_campaigns": active,
        "scheduled": scheduled,
        "campaigns_total": len(rows),
    }


def update_campaign(campaign_id: str, patch: dict) -> dict | None:
    campaign = get_campaign(campaign_id)
    if not campaign:
        return None
    allowed = {"name", "message", "poster", "scheduled_at", "status", "pause_reason"}
    for key, value in patch.items():
        if key in allowed:
            campaign[key] = value
    return save_campaign(campaign)


def delete_campaign(campaign_id: str) -> bool:
    rows = list_campaigns()
    next_rows = [r for r in rows if r.get("id") != campaign_id]
    if len(next_rows) == len(rows):
        return False
    _write(config.CAMPAIGNS_FILE, next_rows)
    return True


def get_lead(lead_id: str) -> dict | None:
    for row in list_leads():
        if row.get("id") == lead_id:
            return row
    return None


def create_lead(payload: dict) -> dict:
    seed_if_empty()
    existing = _read(config.LEADS_FILE, [])
    phone = "".join(c for c in str(payload.get("phone") or "") if c.isdigit())
    if not phone:
        raise ValueError("phone required")
    item = {
        "id": str(uuid.uuid4()),
        "full_name": str(payload.get("full_name") or "Lead").strip(),
        "phone": phone,
        "status": _normalize_status(str(payload.get("status") or "new")),
        "source": str(payload.get("source") or "manual").strip() or "manual",
        "created_at": payload.get("created_at") or _now(),
        "next_follow_up_at": payload.get("next_follow_up_at"),
        "notes": str(payload.get("notes") or ""),
        "workspace_id": payload.get("workspace_id"),
        "origin": payload.get("origin") or "manual",
    }
    # replace by phone if exists
    for i, row in enumerate(existing):
        if "".join(c for c in str(row.get("phone") or "") if c.isdigit()) == phone:
            item["id"] = row.get("id") or item["id"]
            existing[i] = item
            _write(config.LEADS_FILE, existing)
            return item
    existing.append(item)
    _write(config.LEADS_FILE, existing)
    return item


def update_lead(lead_id: str, patch: dict) -> dict | None:
    seed_if_empty()
    existing = _read(config.LEADS_FILE, [])
    for i, row in enumerate(existing):
        if row.get("id") != lead_id:
            continue
        if "full_name" in patch and patch["full_name"] is not None:
            row["full_name"] = str(patch["full_name"]).strip()
        if "phone" in patch and patch["phone"] is not None:
            phone = "".join(c for c in str(patch["phone"]) if c.isdigit())
            if phone:
                row["phone"] = phone
        if "status" in patch and patch["status"] is not None:
            row["status"] = _normalize_status(str(patch["status"]))
        if "notes" in patch:
            row["notes"] = str(patch["notes"] or "")
        if "source" in patch and patch["source"] is not None:
            row["source"] = str(patch["source"])
        if "next_follow_up_at" in patch:
            row["next_follow_up_at"] = patch["next_follow_up_at"]
        existing[i] = row
        _write(config.LEADS_FILE, existing)
        return row
    return None


def delete_lead(lead_id: str) -> bool:
    seed_if_empty()
    existing = _read(config.LEADS_FILE, [])
    next_rows = [r for r in existing if r.get("id") != lead_id]
    if len(next_rows) == len(existing):
        return False
    _write(config.LEADS_FILE, next_rows)
    return True


def append_campaign_log(campaign_id: str, entry: dict) -> dict | None:
    campaign = get_campaign(campaign_id)
    if not campaign:
        return None
    logs = campaign.get("logs") or []
    logs.append(entry)
    if len(logs) > 300:
        logs = logs[-300:]
    campaign["logs"] = logs
    return save_campaign(campaign)


def _normalize_status(value: str | None) -> str:
    raw = (value or "excel").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {
        "excel_stage": "excel",
        "xls": "excel",
        "xlsx": "excel",
        "imported": "excel",
        "followup": "follow_up",
        "follow-up": "follow_up",
        "docs": "documents_pending",
        "document_pending": "documents_pending",
    }
    raw = aliases.get(raw, raw)
    if raw not in config.LEAD_STATUSES:
        return "excel"
    return raw


def import_leads_rows(rows: list[dict], *, default_status: str = "excel", source: str = "excel") -> int:
    seed_if_empty()
    existing = _read(config.LEADS_FILE, [])
    by_phone = {"".join(c for c in str(r.get("phone") or "") if c.isdigit()): r for r in existing}
    added = 0
    updated = 0
    for row in rows:
        phone = "".join(
            c
            for c in str(row.get("phone") or row.get("Phone") or row.get("mobile") or row.get("Mobile") or row.get("whatsapp") or "")
            if c.isdigit()
        )
        if not phone:
            continue
        name = (
            row.get("name")
            or row.get("Name")
            or row.get("full_name")
            or row.get("Full Name")
            or row.get("lead_name")
            or "Lead"
        )
        status = _normalize_status(str(row.get("status") or row.get("Status") or row.get("stage") or row.get("Stage") or default_status))
        item = {
            "id": str(uuid.uuid4()),
            "full_name": str(name).strip(),
            "phone": phone,
            "status": status,
            "source": str(row.get("source") or row.get("Source") or source).strip() or source,
            "created_at": (row.get("created_at") or row.get("Created At") or _now()),
            "next_follow_up_at": row.get("next_follow_up_at") or row.get("Follow Up") or None,
            "notes": str(row.get("notes") or row.get("Notes") or ""),
            "origin": source,
        }
        if phone in by_phone:
            old = by_phone[phone]
            item["id"] = old.get("id") or item["id"]
            for i, r in enumerate(existing):
                if "".join(c for c in str(r.get("phone") or "") if c.isdigit()) == phone:
                    existing[i] = item
                    break
            updated += 1
        else:
            existing.append(item)
            by_phone[phone] = item
            added += 1
    _write(config.LEADS_FILE, existing)
    return added + updated


def import_leads_csv_rows(rows: list[dict]) -> int:
    return import_leads_rows(rows, default_status="excel", source="excel")


def replace_with_crm_leads(rows: list[dict], *, project_id: str | None = None) -> int:
    """Keep excel + WhatsApp contacts; replace previous CRM-synced rows for this project."""
    seed_if_empty()
    existing = _read(config.LEADS_FILE, [])

    def _is_local_keep(r: dict) -> bool:
        origin = r.get("origin")
        status = r.get("status")
        source = r.get("source")
        if origin == "whatsapp" or status == "whatsapp_contact" or source == "whatsapp":
            return True
        if origin == "excel" or status == "excel" or source == "excel":
            return True
        if origin not in (None, "crm", "local_seed") and source == "excel":
            return True
        return False

    def _crm_for_other_project(r: dict) -> bool:
        if _is_local_keep(r):
            return False
        if not project_id:
            return False
        return bool(r.get("project_id") and r.get("project_id") != project_id)

    kept = [r for r in existing if _is_local_keep(r) or _crm_for_other_project(r)]
    merged = {"".join(c for c in str(r.get("phone") or "") if c.isdigit()): r for r in kept if r.get("phone")}
    for row in rows:
        phone = "".join(c for c in str(row.get("phone") or "") if c.isdigit())
        if not phone:
            continue
        existing_local = merged.get(phone)
        if existing_local and _is_local_keep(existing_local):
            continue
        tagged = {**row, "phone": phone, "origin": row.get("origin") or "crm", "source": row.get("source") or "crm"}
        if project_id:
            tagged["project_id"] = project_id
        merged[phone] = tagged
    final = list(merged.values())
    _write(config.LEADS_FILE, final)
    return len(rows)


def filter_by_project(rows: list[dict], project_id: str | None) -> list[dict]:
    if not project_id:
        return rows
    return [r for r in rows if not r.get("project_id") or r.get("project_id") == project_id]


def stage_counts(*, source: str | None = None, workspace_id: str | None = None) -> dict[str, int]:
    """Count every lead stage (and always include known stages with 0)."""
    rows = _read(config.LEADS_FILE, []) if config.LEADS_FILE.exists() else []
    if source == "excel":
        rows = [r for r in rows if r.get("origin") == "excel" or r.get("status") == "excel" or r.get("source") == "excel"]
    elif source == "crm":
        rows = [r for r in rows if r.get("origin") == "crm"]
    elif source == "whatsapp":
        rows = [r for r in rows if r.get("origin") == "whatsapp" or r.get("status") == "whatsapp_contact"]
    if workspace_id:
        rows = [r for r in rows if not r.get("workspace_id") or r.get("workspace_id") == workspace_id]

    counts = {s: 0 for s in config.LEAD_STATUSES}
    for row in rows:
        st = row.get("status") or "unknown"
        counts[st] = int(counts.get(st) or 0) + 1
    return counts


def clear_local_leads() -> None:
    _write(config.LEADS_FILE, [])
