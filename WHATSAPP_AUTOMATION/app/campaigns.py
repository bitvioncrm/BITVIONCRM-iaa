from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from app import accounts, anti_block, config, store, waha_client

_running: set[str] = set()


def render_message(template: str, lead: dict) -> str:
    return anti_block.personalize(template, lead)


async def _send_with_retry(phone: str, text: str, poster_path: Path | None, kind: str, session: str | None) -> dict:
    last_exc: Exception | None = None
    for attempt in range(config.MAX_RETRIES + 1):
        try:
            if poster_path:
                return await waha_client.send_image(phone, poster_path, caption=text, session=session)
            if not text.strip():
                raise ValueError("empty message")
            return await waha_client.send_text(phone, text, session=session)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < config.MAX_RETRIES:
                await asyncio.sleep(2 ** attempt * 3 + anti_block.message_delay() * 0.15)
    assert last_exc is not None
    raise last_exc


async def run_campaign(campaign_id: str) -> None:
    if campaign_id in _running:
        return
    _running.add(campaign_id)
    try:
        campaign = store.get_campaign(campaign_id)
        if not campaign:
            return

        # Honor schedule
        scheduled = campaign.get("scheduled_at")
        if scheduled:
            try:
                when = datetime.fromisoformat(scheduled.replace("Z", "+00:00"))
                while datetime.now(timezone.utc) < when:
                    campaign = store.get_campaign(campaign_id) or campaign
                    if campaign.get("status") == "cancelled":
                        return
                    await asyncio.sleep(min(30, max(1, (when - datetime.now(timezone.utc)).total_seconds())))
            except ValueError:
                pass

        campaign["status"] = "running"
        campaign["started_at"] = datetime.now(timezone.utc).isoformat()
        campaign["pause_reason"] = None
        store.save_campaign(campaign)

        snapshot = {l["id"]: l for l in (campaign.get("leads_snapshot") or [])}
        leads_by_id = {**{l["id"]: l for l in store.list_leads()}, **snapshot}

        poster_path = None
        if campaign.get("poster"):
            candidate = config.POSTERS_DIR / Path(campaign["poster"]).name
            if candidate.exists():
                poster_path = candidate

        lead_ids = campaign.get("lead_ids") or []
        total = len(lead_ids)
        kind = campaign.get("kind") or "bulk"
        session = campaign.get("session") or accounts.active_id()

        for idx, lead_id in enumerate(lead_ids, start=1):
            campaign = store.get_campaign(campaign_id) or campaign
            if campaign.get("status") == "cancelled":
                break

            # Business hours + caps
            ok_caps, reason = anti_block.can_send_more()
            if not ok_caps:
                if "Outside business hours" in reason:
                    campaign["status"] = "paused"
                    campaign["pause_reason"] = reason
                    store.save_campaign(campaign)
                    wait = anti_block.seconds_until_business_hours()
                    await asyncio.sleep(min(wait or 60, 600))
                    campaign = store.get_campaign(campaign_id) or campaign
                    if campaign.get("status") == "cancelled":
                        break
                    campaign["status"] = "running"
                    campaign["pause_reason"] = None
                    store.save_campaign(campaign)
                    # retry same index
                    # (continue without advancing — reprocess this lead)
                    # We already consumed this iteration; re-queue by decrementing isn't clean;
                    # instead sleep then process current lead below.
                elif "Hourly" in reason:
                    campaign["status"] = "paused"
                    campaign["pause_reason"] = reason
                    store.save_campaign(campaign)
                    await asyncio.sleep(120)
                    campaign = store.get_campaign(campaign_id) or campaign
                    if campaign.get("status") == "cancelled":
                        break
                    campaign["status"] = "running"
                    campaign["pause_reason"] = None
                    store.save_campaign(campaign)
                else:
                    campaign["status"] = "paused"
                    campaign["pause_reason"] = reason
                    store.save_campaign(campaign)
                    break

            if anti_block.recent_error_rate() >= config.ERROR_RATE_PAUSE:
                campaign["status"] = "paused"
                campaign["pause_reason"] = "High error rate — auto pause for cool-down"
                store.save_campaign(campaign)
                await asyncio.sleep(anti_block.batch_pause() * 2)
                campaign = store.get_campaign(campaign_id) or campaign
                if campaign.get("status") == "cancelled":
                    break
                campaign["status"] = "running"
                campaign["pause_reason"] = None
                store.save_campaign(campaign)

            lead = leads_by_id.get(lead_id)
            if not lead:
                campaign["skipped"] = int(campaign.get("skipped") or 0) + 1
                store.append_campaign_log(
                    campaign_id,
                    {"at": datetime.now(timezone.utc).isoformat(), "ok": False, "phone": "", "error": "lead missing"},
                )
                store.save_campaign(campaign)
                continue

            text = render_message(campaign.get("message") or "", lead)
            phone = lead.get("phone") or ""
            try:
                await _send_with_retry(phone, text, poster_path, kind if poster_path else "bulk", session)
                campaign["sent"] = int(campaign.get("sent") or 0) + 1
                # Delivered tracks successful API accepts; read awaits WAHA status webhooks
                campaign["delivered"] = int(campaign.get("delivered") or 0) + 1
                anti_block.record_send(True)
                store.append_campaign_log(
                    campaign_id,
                    {
                        "at": datetime.now(timezone.utc).isoformat(),
                        "ok": True,
                        "phone": phone,
                        "name": lead.get("full_name"),
                    },
                )
            except Exception as exc:  # noqa: BLE001
                campaign["failed"] = int(campaign.get("failed") or 0) + 1
                anti_block.record_send(False)
                store.append_campaign_log(
                    campaign_id,
                    {
                        "at": datetime.now(timezone.utc).isoformat(),
                        "ok": False,
                        "phone": phone,
                        "name": lead.get("full_name"),
                        "error": str(exc),
                    },
                )

            campaign["progress"] = idx
            campaign["total"] = total
            store.save_campaign(campaign)

            if idx < total:
                # Batch cool-down every N messages
                if config.BULK_BATCH_SIZE > 0 and idx % config.BULK_BATCH_SIZE == 0:
                    campaign["status"] = "cooling"
                    campaign["pause_reason"] = f"Batch cool-down after {idx} messages"
                    store.save_campaign(campaign)
                    await asyncio.sleep(anti_block.batch_pause())
                    campaign = store.get_campaign(campaign_id) or campaign
                    if campaign.get("status") == "cancelled":
                        break
                    campaign["status"] = "running"
                    campaign["pause_reason"] = None
                    store.save_campaign(campaign)
                else:
                    await asyncio.sleep(anti_block.message_delay())

        campaign = store.get_campaign(campaign_id) or campaign
        if campaign.get("status") == "paused":
            # Leave unfinished so it can be resumed later
            store.save_campaign(campaign)
        else:
            if campaign.get("status") != "cancelled":
                campaign["status"] = "completed"
                campaign["pause_reason"] = None
            campaign["finished_at"] = datetime.now(timezone.utc).isoformat()
            store.save_campaign(campaign)
    finally:
        _running.discard(campaign_id)


def start_campaign_background(campaign_id: str) -> None:
    asyncio.create_task(run_campaign(campaign_id))
