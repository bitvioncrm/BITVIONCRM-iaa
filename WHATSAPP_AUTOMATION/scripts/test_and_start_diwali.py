"""Ensure WAHA session, test 8137864105, then resume Diwali campaign."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import accounts, campaigns, store, waha_client  # noqa: E402

TEST_PHONE = "8137864105"
MESSAGE = (
    "✨ Celebrate Diwali with Dr. K’s Aesthetics! 🪔 Enjoy 20% OFF on eligible treatments "
    "with our exclusive 6-month membership offer. 💛 Offer valid from October 26 to November 26. "
    "Don't miss out! ✨"
)
POSTER = "diwali-membership-offer.jpg"
NAME = "Diwali Membership Offer"


async def wait_working(timeout_s: int = 180, session: str = "default") -> dict:
    import base64

    accounts.set_active(session) if hasattr(accounts, "set_active") else None
    await waha_client.ensure_session(session=session)
    elapsed = 0
    while elapsed < timeout_s:
        info = await waha_client.session_info(session)
        status = (info.get("status") or "").upper()
        print(f"session {session}: {status}", flush=True)
        if status == "WORKING":
            return info
        if status in {"SCAN_QR_CODE", "STARTING"}:
            try:
                qr = await waha_client.get_qr(session=session, restart_if_failed=False, force_fresh=elapsed == 0)
                raw = str((qr or {}).get("qr") or "")
                if raw.startswith("data:"):
                    out = ROOT / "qr-diwali.png"
                    out.write_bytes(base64.b64decode(raw.split(",", 1)[1]))
                    print(f"QR saved to {out} — Linked devices → scan this QR", flush=True)
            except Exception as exc:  # noqa: BLE001
                print(f"qr fetch: {exc}", flush=True)
        await asyncio.sleep(5)
        elapsed += 5
        if status in {"FAILED", "STOPPED"}:
            await waha_client.ensure_session(session=session, force_reset=True)
    raise SystemExit(
        "WhatsApp session did not become WORKING. Open http://127.0.0.1:5178, scan QR with the clinic phone, then re-run scripts/test_and_start_diwali.py"
    )


async def main() -> None:
    session = "default"
    # Prefer default clinic session for Diwali
    try:
        import json
        from pathlib import Path as P

        path = P(ROOT) / "data" / "accounts.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["active"] = session
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    info = await wait_working(session=session)
    print("me", (info.get("me") or {}), flush=True)

    poster = Path(ROOT) / "posters" / POSTER
    print(f"Test send to {TEST_PHONE}…", flush=True)
    result = await waha_client.send_image(TEST_PHONE, poster, caption=MESSAGE, session=session)
    print("test_result", result, flush=True)

    camp = next((c for c in store.list_campaigns() if c.get("name") == NAME and c.get("status") == "paused"), None)
    if not camp:
        camp = next((c for c in store.list_campaigns() if c.get("name") == NAME), None)
    if not camp:
        raise SystemExit("Diwali campaign not found — run seed_diwali_campaign.py first")

    camp["status"] = "queued"
    camp["pause_reason"] = None
    camp["session"] = session
    store.save_campaign(camp)
    campaigns.start_campaign_background(camp["id"])
    print(f"Bulk started campaign={camp['id']} total={camp.get('total')} (paced; daily cap applies)", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
