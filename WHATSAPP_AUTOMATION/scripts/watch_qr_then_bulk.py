"""Wait until WAHA default session is WORKING, test 8137864105, start Diwali bulk."""
from __future__ import annotations

import asyncio
import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import campaigns, store, waha_client  # noqa: E402

SESSION = "default"
TEST_PHONE = "8137864105"
NAME = "Diwali Membership Offer"
POSTER = ROOT / "posters" / "diwali-membership-offer.jpg"
MESSAGE = (
    "✨ Celebrate Diwali with Dr. K’s Aesthetics! 🪔 Enjoy 20% OFF on eligible treatments "
    "with our exclusive 6-month membership offer. 💛 Offer valid from October 26 to November 26. "
    "Don't miss out! ✨"
)


async def save_qr() -> None:
    try:
        qr = await waha_client.get_qr(session=SESSION, restart_if_failed=True, force_fresh=True)
        raw = str((qr or {}).get("qr") or "")
        if raw.startswith("data:"):
            (ROOT / "qr-diwali.png").write_bytes(base64.b64decode(raw.split(",", 1)[1]))
            print("QR updated: qr-diwali.png — Linked devices → Link a device", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"qr: {exc}", flush=True)


async def main() -> None:
    accounts = json.loads((ROOT / "data" / "accounts.json").read_text(encoding="utf-8"))
    accounts["active"] = SESSION
    (ROOT / "data" / "accounts.json").write_text(json.dumps(accounts, indent=2), encoding="utf-8")

    await waha_client.ensure_session(session=SESSION)
    await save_qr()
    print("Waiting for WhatsApp Web link on session=default…", flush=True)
    print("Open http://127.0.0.1:5178 → Scan & Connect, or scan qr-diwali.png", flush=True)

    for i in range(720):  # up to ~60 minutes
        try:
            info = await waha_client.session_info(SESSION)
        except Exception as exc:  # noqa: BLE001
            print(f"[{i}] session_info error: {exc}", flush=True)
            await asyncio.sleep(5)
            continue
        status = (info.get("status") or "").upper()
        if i % 3 == 0:
            print(f"[{i}] {status}", flush=True)
        if status == "WORKING":
            print("CONNECTED", info.get("me"), flush=True)
            result = await waha_client.send_image(TEST_PHONE, POSTER, caption=MESSAGE, session=SESSION)
            print("TEST_OK", result, flush=True)
            camp = next(
                (c for c in store.list_campaigns() if c.get("name") == NAME and c.get("status") in ("paused", "queued", "cancelled")),
                None,
            ) or next((c for c in store.list_campaigns() if c.get("name") == NAME), None)
            if not camp:
                raise SystemExit("Diwali campaign missing — run seed_diwali_campaign.py")
            camp["status"] = "queued"
            camp["pause_reason"] = None
            camp["session"] = SESSION
            store.save_campaign(camp)
            campaigns.start_campaign_background(camp["id"])
            print(f"BULK_STARTED id={camp['id']} total={camp.get('total')}", flush=True)
            return
        if i % 12 == 11:
            await save_qr()
        if status in {"FAILED", "STOPPED"}:
            await waha_client.ensure_session(session=SESSION, force_reset=True)
            await save_qr()
        await asyncio.sleep(5)

    raise SystemExit("Timed out waiting for QR scan")


if __name__ == "__main__":
    asyncio.run(main())
