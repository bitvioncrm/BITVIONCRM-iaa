from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app import config


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now() -> str:
    return now()


def _blank() -> dict:
    return {"active_id": None, "projects": []}


def _read() -> dict:
    path = config.PROJECTS_FILE
    if not path.exists():
        return _blank()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return _blank()
    if not isinstance(data, dict) or "projects" not in data:
        return _blank()
    return data


def _write(data: dict) -> dict:
    config.PROJECTS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return data


def ensure_seed() -> dict:
    data = _read()
    if data.get("projects"):
        return data
    pid = str(uuid.uuid4())[:10]
    data = {
        "active_id": pid,
        "projects": [
            {
                "id": pid,
                "name": "Dr. K's Aesthetic Clinic",
                "workspace_id": config.CRM_WORKSPACE_ID or None,
                "auto_sync_crm": True,
                "auto_sync_wa": True,
                "created_at": _now(),
                "last_crm_sync_at": None,
                "last_wa_sync_at": None,
                "crm_count": 0,
                "wa_count": 0,
            }
        ],
    }
    return _write(data)


def list_projects() -> list[dict]:
    return list(ensure_seed().get("projects") or [])


def get_active() -> dict | None:
    data = ensure_seed()
    active = data.get("active_id")
    for p in data.get("projects") or []:
        if p.get("id") == active:
            return p
    projects = data.get("projects") or []
    return projects[0] if projects else None


def get_project(project_id: str) -> dict | None:
    for p in list_projects():
        if p.get("id") == project_id:
            return p
    return None


def create_project(
    *,
    name: str,
    workspace_id: str | None = None,
    auto_sync_crm: bool = True,
    auto_sync_wa: bool = True,
    activate: bool = True,
) -> dict:
    data = ensure_seed()
    item = {
        "id": str(uuid.uuid4())[:10],
        "name": (name or "New Project").strip() or "New Project",
        "workspace_id": workspace_id or None,
        "auto_sync_crm": bool(auto_sync_crm),
        "auto_sync_wa": bool(auto_sync_wa),
        "created_at": _now(),
        "last_crm_sync_at": None,
        "last_wa_sync_at": None,
        "crm_count": 0,
        "wa_count": 0,
    }
    data.setdefault("projects", []).insert(0, item)
    if activate:
        data["active_id"] = item["id"]
    _write(data)
    return item


def update_project(project_id: str, patch: dict[str, Any]) -> dict | None:
    data = ensure_seed()
    allowed = {
        "name",
        "workspace_id",
        "auto_sync_crm",
        "auto_sync_wa",
        "last_crm_sync_at",
        "last_wa_sync_at",
        "crm_count",
        "wa_count",
    }
    for i, p in enumerate(data.get("projects") or []):
        if p.get("id") != project_id:
            continue
        for k, v in patch.items():
            if k in allowed:
                p[k] = v
        data["projects"][i] = p
        _write(data)
        return p
    return None


def delete_project(project_id: str) -> bool:
    data = ensure_seed()
    projects = data.get("projects") or []
    if len(projects) <= 1:
        return False
    next_projects = [p for p in projects if p.get("id") != project_id]
    if len(next_projects) == len(projects):
        return False
    data["projects"] = next_projects
    if data.get("active_id") == project_id:
        data["active_id"] = next_projects[0]["id"]
    _write(data)
    return True


def set_active(project_id: str) -> dict | None:
    data = ensure_seed()
    if not any(p.get("id") == project_id for p in data.get("projects") or []):
        return None
    data["active_id"] = project_id
    _write(data)
    return get_project(project_id)


def snapshot() -> dict:
    active = get_active()
    return {
        "active_id": active.get("id") if active else None,
        "active": active,
        "projects": list_projects(),
    }
