from __future__ import annotations

import asyncio
import base64
import mimetypes
from pathlib import Path

import httpx

from app import config


def _headers(extra: dict | None = None) -> dict:
    h = {"Content-Type": "application/json"}
    if config.WAHA_API_KEY:
        h["X-Api-Key"] = config.WAHA_API_KEY
    if extra:
        h.update(extra)
    return h


def _sid(session: str | None) -> str:
    raw = (session or config.WAHA_SESSION or "default").strip()
    safe = "".join(ch for ch in raw if ch.isalnum() or ch in "-_")
    return (safe or "default")[:48]


def to_chat_id(phone: str) -> str:
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if digits.startswith("0") and len(digits) == 11:
        digits = "91" + digits[1:]
    if len(digits) == 10:
        digits = "91" + digits
    if not digits:
        raise ValueError("empty phone")
    return f"{digits}@c.us"


async def session_info(session: str | None = None) -> dict:
    """Fast session status."""
    name = _sid(session)
    async with httpx.AsyncClient(timeout=httpx.Timeout(3.0, connect=1.5)) as client:
        r = await client.get(
            f"{config.WAHA_BASE_URL}/api/sessions/{name}",
            headers=_headers(),
        )
        if r.status_code == 404:
            return {"status": "MISSING", "me": None, "name": name}
        r.raise_for_status()
        data = r.json()
        data.setdefault("name", name)
        return data


async def list_sessions() -> list[dict]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(3.0, connect=1.5)) as client:
        r = await client.get(f"{config.WAHA_BASE_URL}/api/sessions", headers=_headers())
        if r.status_code >= 400:
            return []
        data = r.json()
        return data if isinstance(data, list) else []


async def _create_session(client: httpx.AsyncClient, session: str | None = None) -> dict:
    name = _sid(session)
    r = await client.post(
        f"{config.WAHA_BASE_URL}/api/sessions",
        headers=_headers(),
        json={"name": name, "start": True},
    )
    if r.status_code in (200, 201):
        return r.json() if r.content else await session_info(name)
    if r.status_code in (409, 422):
        r2 = await client.post(
            f"{config.WAHA_BASE_URL}/api/sessions/{name}/start",
            headers=_headers(),
        )
        if r2.status_code < 400:
            return r2.json() if r2.content else await session_info(name)
    r.raise_for_status()
    return r.json() if r.content else await session_info(name)


async def _hard_reset(client: httpx.AsyncClient, session: str | None = None) -> dict:
    """Stop + delete + recreate. Tolerates ENOTEMPTY / already-gone errors."""
    name = _sid(session)
    for path, method in (
        (f"/api/sessions/{name}/stop", "post"),
        (f"/api/sessions/{name}/logout", "post"),
        (f"/api/sessions/{name}", "delete"),
    ):
        try:
            fn = client.post if method == "post" else client.delete
            await fn(f"{config.WAHA_BASE_URL}{path}", headers=_headers())
        except Exception:  # noqa: BLE001
            pass
    await asyncio.sleep(0.4)
    return await _create_session(client, name)


async def ensure_session(*, session: str | None = None, force_reset: bool = False) -> dict:
    """Bring session to SCAN_QR_CODE or WORKING as fast as possible."""
    name = _sid(session)
    async with httpx.AsyncClient(timeout=20) as client:
        if force_reset:
            return await _hard_reset(client, name)

        info = await session_info(name)
        status = (info.get("status") or "").upper()

        if status in {"WORKING", "SCAN_QR_CODE", "STARTING"}:
            return info

        if status == "MISSING":
            return await _create_session(client, name)

        if status in {"STOPPED", "FAILED"}:
            r = await client.post(
                f"{config.WAHA_BASE_URL}/api/sessions/{name}/start",
                headers=_headers(),
            )
            if r.status_code < 400:
                return r.json() if r.content else await session_info(name)
            return await _hard_reset(client, name)

        r = await client.post(
            f"{config.WAHA_BASE_URL}/api/sessions/{name}/start",
            headers=_headers(),
        )
        if r.status_code < 400:
            return r.json() if r.content else await session_info(name)
        return await _hard_reset(client, name)


async def _fetch_qr_png(client: httpx.AsyncClient, session: str | None = None) -> tuple[bytes | None, str | None]:
    name = _sid(session)
    r = await client.get(
        f"{config.WAHA_BASE_URL}/api/{name}/auth/qr",
        headers=_headers({"Accept": "image/png"}),
    )
    if r.status_code < 400 and r.content:
        return r.content, None
    err = r.text[:220]
    try:
        err = r.json().get("error") or err
    except Exception:  # noqa: BLE001
        pass
    return None, err if isinstance(err, str) else str(err)


async def get_qr(*, session: str | None = None, restart_if_failed: bool = True, force_fresh: bool = False) -> dict:
    """Return QR as data-URL PNG while session needs scan."""
    name = _sid(session)
    info = await session_info(name)
    status = (info.get("status") or "").upper()
    engine = info.get("engine") if isinstance(info.get("engine"), dict) else {}
    engine_state = str(engine.get("state") or "").upper()

    if status == "WORKING":
        return {"status": "WORKING", "qr": None, "me": info.get("me")}

    need_reset = status in {"FAILED", "STOPPED", "MISSING"} or engine_state in {
        "UNPAIRED_IDLE",
        "TIMEOUT",
        "CONFLICT",
    }
    if restart_if_failed and need_reset:
        try:
            info = await ensure_session(
                session=name,
                force_reset=status == "FAILED" or engine_state in {"UNPAIRED_IDLE", "TIMEOUT", "CONFLICT"}
            )
            status = (info.get("status") or "").upper()
        except Exception as exc:  # noqa: BLE001
            return {
                "status": status or "FAILED",
                "qr": None,
                "me": None,
                "error": f"Could not restart session: {exc}",
            }

    if status == "WORKING":
        return {"status": "WORKING", "qr": None, "me": info.get("me")}

    async with httpx.AsyncClient(timeout=8) as client:
        for _ in range(30):
            if status == "WORKING":
                return {"status": "WORKING", "qr": None, "me": info.get("me")}
            if status == "FAILED":
                break
            png, err = await _fetch_qr_png(client, name)
            if png and len(png) > 500:
                b64 = base64.b64encode(png).decode("ascii")
                return {
                    "status": status if status in {"SCAN_QR_CODE", "STARTING"} else "SCAN_QR_CODE",
                    "qr": f"data:image/png;base64,{b64}",
                    "me": info.get("me"),
                    "fresh": bool(force_fresh),
                }
            await asyncio.sleep(0.6)
            info = await session_info(name)
            status = (info.get("status") or "").upper()

        return {
            "status": status or "UNKNOWN",
            "qr": None,
            "me": info.get("me"),
            "error": (
                "Starting browser… QR appears in a few seconds"
                if status == "STARTING"
                else f"Session is {status}. Click Restart Session."
            ),
        }


async def logout_session(session: str | None = None) -> dict:
    name = _sid(session)
    async with httpx.AsyncClient(timeout=20) as client:
        for path in (
            f"/api/sessions/{name}/logout",
            f"/api/sessions/{name}/stop",
        ):
            r = await client.post(f"{config.WAHA_BASE_URL}{path}", headers=_headers())
            if r.status_code < 400 or r.status_code == 404:
                break
        return {"ok": True, "status": (await session_info(name)).get("status")}


async def delete_session(session: str | None = None) -> dict:
    name = _sid(session)
    async with httpx.AsyncClient(timeout=httpx.Timeout(4.0, connect=1.5)) as client:
        for path, method in (
            (f"/api/sessions/{name}/logout", "post"),
            (f"/api/sessions/{name}/stop", "post"),
            (f"/api/sessions/{name}", "delete"),
        ):
            try:
                fn = client.post if method == "post" else client.delete
                await fn(f"{config.WAHA_BASE_URL}{path}", headers=_headers())
            except Exception:  # noqa: BLE001
                pass
    return {"ok": True, "name": name}


def _digits(value: object) -> str:
    return "".join(ch for ch in str(value or "").split("@")[0] if ch.isdigit())


def _phone_from_wa_id(cid: str) -> str:
    """Prefer real WhatsApp id (9198…@c.us), never LID-only numbers."""
    raw = str(cid or "")
    if "@g.us" in raw or "status@broadcast" in raw or "@lid" in raw:
        return ""
    if "@c.us" not in raw and not raw.isdigit():
        return ""
    digits = _digits(raw)
    # Real mobile WA ids are typically 10–15 digits; reject empty / 0 / tiny
    if len(digits) < 10 or len(digits) > 15:
        return ""
    if digits in {"0", "0000000000"}:
        return ""
    return digits


def _normalize_wa_phone(digits: str) -> str:
    if len(digits) == 10:
        return "91" + digits
    return digits


def _contact_row(phone: str, name: str) -> dict:
    phone = _normalize_wa_phone(phone)
    return {
        "id": f"wa:{phone}",
        "full_name": (name or phone).strip() or phone,
        "phone": phone,
        "status": "whatsapp_contact",
        "source": "whatsapp",
        "origin": "whatsapp",
        "created_at": None,
    }


def _parse_contact_item(c: dict) -> tuple[dict | None, str | None]:
    """Return (contact_row, lid) — lid lets LID-only chats resolve to a phone."""
    if not isinstance(c, dict):
        return None, None
    if c.get("isMe") or c.get("isGroup"):
        return None, None
    cid = str(c.get("id") or "")
    if "@g.us" in cid or "status@broadcast" in cid:
        return None, None
    # Prefer real phone from @c.us id. WAHA "number" is often an internal LID.
    phone = _phone_from_wa_id(cid)
    lid = _digits(c.get("number"))
    if lid and phone and lid == phone:
        lid = None
    if not phone:
        alt = _digits(c.get("phone") or c.get("phoneNumber"))
        if 10 <= len(alt) <= 13:
            phone = alt
    if not phone:
        return None, lid or None
    name = (
        c.get("name")
        or c.get("pushname")
        or c.get("pushName")
        or c.get("shortName")
        or c.get("notify")
        or phone
    )
    return _contact_row(phone, str(name)), (lid or None)


def _parse_chat_item(chat: dict, lid_map: dict[str, str] | None = None) -> dict | None:
    if not isinstance(chat, dict):
        return None
    if chat.get("isGroup"):
        return None
    cid = chat.get("id")
    server = ""
    user = ""
    if isinstance(cid, dict):
        server = str(cid.get("server") or "")
        user = str(cid.get("user") or "")
        cid = cid.get("_serialized") or ""
    cid = str(cid or "")
    phone = ""
    if server == "c.us" or "@c.us" in cid:
        phone = _phone_from_wa_id(cid if "@" in cid else f"{user}@c.us")
    elif server == "lid" or "@lid" in cid:
        lid = user or _digits(cid)
        if lid_map and lid in lid_map:
            phone = lid_map[lid]
    else:
        phone = _phone_from_wa_id(cid)
    if not phone:
        return None
    name = chat.get("name") or chat.get("pushName") or chat.get("notify") or phone
    return _contact_row(phone, str(name))


async def list_contacts(limit: int = 2000, session: str | None = None) -> list[dict]:
    """Fetch WhatsApp people: address book (phones) + chats (resolved via LID map)."""
    out: dict[str, dict] = {}
    lid_map: dict[str, str] = {}  # internal LID → phone

    name = _sid(session)
    async with httpx.AsyncClient(timeout=httpx.Timeout(50.0, connect=3.0)) as client:
        # 1) Address book first — needed for correct phones + LID mapping
        try:
            r = await client.get(
                f"{config.WAHA_BASE_URL}/api/contacts/all",
                headers=_headers(),
                params={"session": name, "limit": str(min(limit, 1200))},
            )
            if r.status_code < 400:
                raw = r.json()
                rows = raw if isinstance(raw, list) else (raw.get("data") or raw.get("contacts") or [])
                for c in rows:
                    row, lid = _parse_contact_item(c)
                    if row:
                        out[row["phone"]] = row
                        if lid:
                            lid_map[lid] = row["phone"]
        except Exception:  # noqa: BLE001
            pass

        # 2) Chats — fill names / anyone missing from address book
        try:
            r = await client.get(
                f"{config.WAHA_BASE_URL}/api/{name}/chats",
                headers=_headers(),
                params={"limit": str(min(limit, 500))},
            )
            if r.status_code < 400:
                raw = r.json()
                rows = raw if isinstance(raw, list) else (raw.get("data") or raw.get("chats") or [])
                for chat in rows:
                    row = _parse_chat_item(chat, lid_map)
                    if not row:
                        continue
                    prev = out.get(row["phone"])
                    if prev and prev.get("full_name") and prev["full_name"] != prev["phone"]:
                        if row["full_name"] == row["phone"]:
                            continue
                    out[row["phone"]] = row
        except Exception:  # noqa: BLE001
            pass

    # Drop self if present
    try:
        me = await session_info(name)
        me_id = str((me.get("me") or {}).get("id") or "")
        me_phone = _phone_from_wa_id(me_id)
        if me_phone:
            out.pop(_normalize_wa_phone(me_phone), None)
            out.pop(me_phone, None)
    except Exception:  # noqa: BLE001
        pass

    rows = list(out.values())
    rows.sort(key=lambda r: (r.get("full_name") or "").lower())
    return rows[:limit]


async def send_text(phone: str, text: str, session: str | None = None) -> dict:
    chat_id = to_chat_id(phone)
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{config.WAHA_BASE_URL}/api/sendText",
            headers=_headers(),
            json={
                "session": _sid(session),
                "chatId": chat_id,
                "text": text,
            },
        )
        r.raise_for_status()
        return r.json()


async def send_image(phone: str, image_path: Path, caption: str = "", session: str | None = None) -> dict:
    chat_id = to_chat_id(phone)
    mime = mimetypes.guess_type(str(image_path))[0] or "image/jpeg"
    raw = image_path.read_bytes()
    b64 = base64.b64encode(raw).decode("ascii")
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{config.WAHA_BASE_URL}/api/sendImage",
            headers=_headers(),
            json={
                "session": _sid(session),
                "chatId": chat_id,
                "caption": caption,
                "file": {
                    "mimetype": mime,
                    "filename": image_path.name,
                    "data": b64,
                },
            },
        )
        r.raise_for_status()
        return r.json()
