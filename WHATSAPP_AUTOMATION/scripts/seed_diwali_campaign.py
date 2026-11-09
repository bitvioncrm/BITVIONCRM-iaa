"""Seed Diwali membership campaign + sync clinic CRM leads into local store."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import config, crm, projects, store  # noqa: E402

WORKSPACE_ID = "8d5ecf49-2ebc-4500-8b9e-65ae411bcf7b"
POSTER = "diwali-membership-offer.jpg"
MESSAGE = (
    "✨ Celebrate Diwali with Dr. K’s Aesthetics! 🪔 Enjoy 20% OFF on eligible treatments "
    "with our exclusive 6-month membership offer. 💛 Offer valid from October 26 to November 26. "
    "Don't miss out! ✨"
)
NAME = "Diwali Membership Offer"


async def main() -> None:
    poster = config.POSTERS_DIR / POSTER
    if not poster.exists():
        raise SystemExit(f"Missing poster: {poster}")

    active = projects.get_active()
    if not active:
        active = projects.create_project(
            name="Dr. K's Aesthetic Clinic",
            workspace_id=WORKSPACE_ID,
            auto_sync_crm=True,
            auto_sync_wa=True,
            activate=True,
        )
    else:
        projects.update_project(
            active["id"],
            {"workspace_id": WORKSPACE_ID, "auto_sync_crm": True, "name": active.get("name") or "Dr. K's Aesthetic Clinic"},
        )
        active = projects.get_active()

    print("Fetching clinic leads from Supabase…")
    rows = await crm.fetch_all_leads(workspace_id=WORKSPACE_ID)
    print(f"Fetched {len(rows)} CRM rows with phones")
    count = store.replace_with_crm_leads(rows, project_id=(active or {}).get("id"))
    if active:
        projects.update_project(active["id"], {"crm_count": count, "last_crm_sync_at": projects.now()})
    print(f"Local CRM cache: {count}")

    local = [
        row
        for row in store.list_leads()
        if str(row.get("phone") or "").strip()
        and (not row.get("workspace_id") or row.get("workspace_id") == WORKSPACE_ID)
    ]
    print(f"Campaign recipients: {len(local)}")

    for camp in store.list_campaigns():
        if camp.get("name") == NAME and camp.get("status") in ("queued", "running", "paused", "scheduled"):
            camp["status"] = "cancelled"
            store.save_campaign(camp)

    campaign = store.create_campaign(
        name=NAME,
        kind="poster",
        message=MESSAGE,
        poster=POSTER,
        lead_ids=[row["id"] for row in local],
        filters={"workspace_id": WORKSPACE_ID, "source": "crm"},
        leads_snapshot=local,
        scheduled_at=None,
        session=None,
    )
    campaign["status"] = "paused"
    campaign["pause_reason"] = "Waiting for WhatsApp Web QR session (WAHA WORKING)"
    store.save_campaign(campaign)
    print(f"Campaign ready id={campaign['id']} total={campaign['total']} poster={POSTER} status=paused")


if __name__ == "__main__":
    asyncio.run(main())
