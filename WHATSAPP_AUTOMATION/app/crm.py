from __future__ import annotations

from typing import Any

import httpx

from app import config


def crm_configured() -> bool:
    return bool(config.SUPABASE_URL and config.SUPABASE_SERVICE_ROLE_KEY)


def _headers() -> dict:
    return {
        "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "count=exact",
    }


def _client() -> httpx.AsyncClient:
    # Local Windows Python SSL store is unreliable here; disable verify for CRM console use.
    return httpx.AsyncClient(timeout=60, verify=False)


async def fetch_all_leads(
    *,
    statuses: list[str] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    search: str | None = None,
    reminder_only: bool = False,
    workspace_id: str | None = None,
) -> list[dict[str, Any]]:
    if not crm_configured():
        return []

    page = 1000
    offset = 0
    out: list[dict[str, Any]] = []

    async with _client() as client:
        while True:
            params: list[tuple[str, str]] = [
                ("select", "id,full_name,phone,whatsapp,status,source,created_at,next_follow_up_at,workspace_id"),
                ("deleted_at", "is.null"),
                ("order", "created_at.desc"),
                ("limit", str(page)),
                ("offset", str(offset)),
            ]
            if workspace_id:
                params.append(("workspace_id", f"eq.{workspace_id}"))
            if statuses:
                local_only = {"excel", "whatsapp_contact"}
                crm_statuses = [s for s in statuses if s and s not in local_only]
                if crm_statuses:
                    joined = ",".join(crm_statuses)
                    params.append(("status", f"in.({joined})"))
                elif any(s in local_only for s in statuses):
                    # excel / WhatsApp contacts are local-only stages
                    return []

            if date_from:
                params.append(("created_at", f"gte.{date_from}T00:00:00Z"))
            if date_to:
                params.append(("created_at", f"lte.{date_to}T23:59:59Z"))
            if reminder_only:
                params.append(("next_follow_up_at", "not.is.null"))
            if search:
                q = search.replace(",", " ").strip()
                params.append(("or", f"(full_name.ilike.*{q}*,phone.ilike.*{q}*,whatsapp.ilike.*{q}*)"))

            r = await client.get(
                f"{config.SUPABASE_URL}/rest/v1/leads",
                headers=_headers(),
                params=params,
            )
            r.raise_for_status()
            batch = r.json()
            if not batch:
                break
            for row in batch:
                phone = "".join(c for c in str(row.get("whatsapp") or row.get("phone") or "") if c.isdigit())
                if not phone:
                    continue
                out.append(
                    {
                        "id": str(row.get("id")),
                        "full_name": row.get("full_name") or "Lead",
                        "phone": phone,
                        "status": row.get("status") or "new",
                        "source": row.get("source") or "crm",
                        "created_at": row.get("created_at"),
                        "next_follow_up_at": row.get("next_follow_up_at"),
                        "workspace_id": row.get("workspace_id"),
                        "origin": "crm",
                    }
                )
            if len(batch) < page:
                break
            offset += page
            if offset > 200000:
                break
    return out


async def list_workspaces() -> list[dict]:
    if not crm_configured():
        return []
    async with _client() as client:
        r = await client.get(
            f"{config.SUPABASE_URL}/rest/v1/workspaces",
            headers=_headers(),
            params={"select": "id,name,organization_id,workspace_type", "deleted_at": "is.null", "order": "name"},
        )
        r.raise_for_status()
        return r.json()
