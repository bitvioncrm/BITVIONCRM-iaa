from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone

from app import config

FILE = config.DATA_DIR / "accounts.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug(label: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (label or "").lower()).strip("-")
    if not base or base == "default":
        base = "wa"
    return base[:24]


def _blank() -> dict:
    return {
        "active": config.WAHA_SESSION or "default",
        "accounts": [
            {
                "id": config.WAHA_SESSION or "default",
                "label": "WhatsApp 1",
                "created_at": _now(),
            }
        ],
    }


def _load() -> dict:
    if not FILE.exists():
        data = _blank()
        _save(data)
        return data
    try:
        data = json.loads(FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = _blank()
    accounts = data.get("accounts") if isinstance(data, dict) else None
    if not isinstance(accounts, list) or not accounts:
        data = _blank()
    else:
        data["accounts"] = [row for row in accounts if isinstance(row, dict) and row.get("id")]
        if not data["accounts"]:
            data = _blank()
    ids = {row["id"] for row in data["accounts"]}
    if data.get("active") not in ids:
        data["active"] = data["accounts"][0]["id"]
    return data


def _save(data: dict) -> None:
    FILE.parent.mkdir(exist_ok=True)
    FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def list_accounts() -> list[dict]:
    return list(_load()["accounts"])


def active_id() -> str:
    return str(_load().get("active") or "default")


def add_account(label: str) -> dict:
    data = _load()
    name = (label or "").strip() or f"WhatsApp {len(data['accounts']) + 1}"
    base = _slug(name)
    taken = {row["id"] for row in data["accounts"]}
    session_id = base
    if session_id in taken:
        session_id = f"{base}-{uuid.uuid4().hex[:4]}"
    row = {"id": session_id, "label": name, "created_at": _now()}
    data["accounts"].append(row)
    data["active"] = session_id
    _save(data)
    return row


def set_active(session_id: str) -> dict | None:
    data = _load()
    match = next((row for row in data["accounts"] if row["id"] == session_id), None)
    if not match:
        return None
    data["active"] = session_id
    _save(data)
    return match


def remove_account(session_id: str) -> bool:
    data = _load()
    if len(data["accounts"]) <= 1:
        return False
    kept = [row for row in data["accounts"] if row["id"] != session_id]
    if len(kept) == len(data["accounts"]):
        return False
    data["accounts"] = kept
    if data.get("active") == session_id:
        data["active"] = kept[0]["id"]
    _save(data)
    return True
