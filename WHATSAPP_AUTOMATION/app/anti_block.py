from __future__ import annotations

import json
import random
from datetime import datetime, timezone
from pathlib import Path

from app import config


def _now() -> datetime:
    return datetime.now().astimezone()


def _read_stats() -> dict:
    path = config.SEND_STATS_FILE
    if not path.exists():
        return {"days": {}, "hours": {}, "recent": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {"days": {}, "hours": {}, "recent": []}


def _write_stats(data: dict) -> None:
    config.SEND_STATS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def record_send(ok: bool) -> None:
    now = _now()
    day = now.strftime("%Y-%m-%d")
    hour = now.strftime("%Y-%m-%dT%H")
    data = _read_stats()
    days = data.setdefault("days", {})
    hours = data.setdefault("hours", {})
    recent = data.setdefault("recent", [])
    days[day] = int(days.get(day) or 0) + (1 if ok else 0)
    hours[hour] = int(hours.get(hour) or 0) + (1 if ok else 0)
    recent.append({"at": now.isoformat(), "ok": ok})
    data["recent"] = recent[-200:]
    # prune old keys
    day_keys = sorted(days.keys())
    for k in day_keys[:-14]:
        days.pop(k, None)
    hour_keys = sorted(hours.keys())
    for k in hour_keys[:-72]:
        hours.pop(k, None)
    _write_stats(data)


def daily_sent() -> int:
    day = _now().strftime("%Y-%m-%d")
    return int(_read_stats().get("days", {}).get(day) or 0)


def hourly_sent() -> int:
    hour = _now().strftime("%Y-%m-%dT%H")
    return int(_read_stats().get("hours", {}).get(hour) or 0)


def within_business_hours() -> bool:
    if not config.RESPECT_BUSINESS_HOURS:
        return True
    h = _now().hour
    return config.SEND_START_HOUR <= h < config.SEND_END_HOUR


def seconds_until_business_hours() -> float:
    if within_business_hours():
        return 0.0
    now = _now()
    start = now.replace(hour=config.SEND_START_HOUR, minute=0, second=0, microsecond=0)
    if now.hour >= config.SEND_END_HOUR:
        from datetime import timedelta

        start = start + timedelta(days=1)
    return max(0.0, (start - now).total_seconds())


def can_send_more(remaining_needed: int = 1) -> tuple[bool, str]:
    if daily_sent() >= config.DAILY_SEND_CAP:
        return False, f"Daily send cap reached ({config.DAILY_SEND_CAP})"
    if hourly_sent() >= config.HOURLY_SEND_CAP:
        return False, f"Hourly send cap reached ({config.HOURLY_SEND_CAP})"
    if not within_business_hours():
        return False, f"Outside business hours ({config.SEND_START_HOUR}:00–{config.SEND_END_HOUR}:00)"
    _ = remaining_needed
    return True, "ok"


def recent_error_rate(window: int | None = None) -> float:
    window = window or config.ERROR_WINDOW
    recent = _read_stats().get("recent") or []
    slice_ = recent[-window:]
    if len(slice_) < max(5, window // 2):
        return 0.0
    fails = sum(1 for x in slice_ if not x.get("ok"))
    return fails / len(slice_)


def message_delay() -> float:
    return random.uniform(config.BULK_DELAY_MIN, config.BULK_DELAY_MAX)


def batch_pause() -> float:
    return random.uniform(config.BULK_BATCH_PAUSE_MIN, config.BULK_BATCH_PAUSE_MAX)


def personalize(template: str, lead: dict) -> str:
    """Render variables and lightly vary identical blasts."""
    text = template or ""
    name = (lead.get("full_name") or "there").strip()
    first = name.split()[0] if name else "there"
    text = (
        text.replace("{name}", name)
        .replace("{{name}}", name)
        .replace("{first_name}", first)
        .replace("{{first_name}}", first)
        .replace("{phone}", lead.get("phone") or "")
        .replace("{{phone}}", lead.get("phone") or "")
        .replace("{status}", lead.get("status") or "")
        .replace("{{status}}", lead.get("status") or "")
    )
    # Soft variation so bulk copies are not byte-identical
    variants = ["", " ", "\u200b"]  # space / zero-width
    if random.random() < 0.4 and not text.endswith(("?", "!", ".")):
        text = text.rstrip() + random.choice([".", "!", ""])
    elif random.random() < 0.25:
        text = text + random.choice(variants)
    return text


def caps_snapshot() -> dict:
    return {
        "daily_sent": daily_sent(),
        "daily_cap": config.DAILY_SEND_CAP,
        "hourly_sent": hourly_sent(),
        "hourly_cap": config.HOURLY_SEND_CAP,
        "delay_min": config.BULK_DELAY_MIN,
        "delay_max": config.BULK_DELAY_MAX,
        "batch_size": config.BULK_BATCH_SIZE,
        "business_hours": f"{config.SEND_START_HOUR}:00–{config.SEND_END_HOUR}:00",
        "respect_business_hours": config.RESPECT_BUSINESS_HOURS,
        "within_hours": within_business_hours(),
        "error_rate": round(recent_error_rate(), 3),
    }
