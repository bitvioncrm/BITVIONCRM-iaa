"""
Bulk WhatsApp sender via WAHA.
Usage:
  1. Start WAHA (docker compose up -d in ./waha)
  2. Scan QR at http://localhost:3000/dashboard
  3. Copy contacts.example.csv -> contacts.csv and edit
  4. python bulk_send.py
  5. Or: python bulk_send.py --dry-run
"""

from __future__ import annotations

import argparse
import csv
import os
import random
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install deps: pip install requests python-dotenv")
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

ROOT = Path(__file__).resolve().parent
if load_dotenv:
    load_dotenv(ROOT / ".env")

BASE_URL = os.getenv("WAHA_BASE_URL", "http://localhost:3000").rstrip("/")
API_KEY = os.getenv("WAHA_API_KEY", "")
SESSION = os.getenv("WAHA_SESSION", "default")
DELAY_MIN = float(os.getenv("BULK_DELAY_MIN", "5"))
DELAY_MAX = float(os.getenv("BULK_DELAY_MAX", "12"))


def headers() -> dict:
    h = {"Content-Type": "application/json"}
    if API_KEY:
        h["X-Api-Key"] = API_KEY
    return h


def to_chat_id(phone: str) -> str:
    digits = "".join(c for c in phone.strip() if c.isdigit())
    if not digits:
        raise ValueError(f"Invalid phone: {phone!r}")
    return f"{digits}@c.us"


def session_status() -> dict | None:
    r = requests.get(
        f"{BASE_URL}/api/sessions/{SESSION}",
        headers=headers(),
        timeout=30,
    )
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def ensure_session() -> None:
    status = session_status()
    if status is None:
        print(f"Creating session '{SESSION}'...")
        r = requests.post(
            f"{BASE_URL}/api/sessions",
            headers=headers(),
            json={"name": SESSION, "start": True},
            timeout=60,
        )
        r.raise_for_status()
        print("Session created. Open the dashboard and scan the QR code.")
        print(f"  Dashboard: {BASE_URL}/dashboard")
        sys.exit(0)

    state = (status.get("status") or status.get("engine", {}).get("state") or "").upper()
    print(f"Session '{SESSION}' status: {status.get('status', state)}")
    if status.get("status") not in ("WORKING", "SCAN_QR_CODE"):
        # still try; WORKING is the ready state
        pass
    if status.get("status") == "SCAN_QR_CODE":
        print("Scan the QR code in the dashboard, then re-run this script.")
        print(f"  Dashboard: {BASE_URL}/dashboard")
        sys.exit(0)
    if status.get("status") != "WORKING":
        print("Session is not WORKING yet. Start/scan QR in the dashboard, then retry.")
        print(f"  Dashboard: {BASE_URL}/dashboard")
        sys.exit(1)


def send_text(chat_id: str, text: str) -> dict:
    r = requests.post(
        f"{BASE_URL}/api/sendText",
        headers=headers(),
        json={"session": SESSION, "chatId": chat_id, "text": text},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def load_contacts(path: Path) -> list[dict]:
    rows = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or "phone" not in reader.fieldnames:
            raise SystemExit("CSV must have a 'phone' column (and optional name, message)")
        for i, row in enumerate(reader, start=2):
            phone = (row.get("phone") or "").strip()
            if not phone:
                continue
            message = (row.get("message") or "").strip()
            name = (row.get("name") or "").strip()
            rows.append({"phone": phone, "name": name, "message": message, "line": i})
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Bulk send WhatsApp messages via WAHA")
    parser.add_argument(
        "--contacts",
        default=str(ROOT / "contacts.csv"),
        help="Path to contacts CSV",
    )
    parser.add_argument(
        "--message",
        default="",
        help="Default message if CSV row has no message column value",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print actions only")
    parser.add_argument("--setup-only", action="store_true", help="Only ensure session / show QR hint")
    args = parser.parse_args()

    print(f"WAHA: {BASE_URL}  session={SESSION}")
    try:
        ensure_session()
    except requests.RequestException as e:
        print(f"Cannot reach WAHA: {e}")
        print("Start it with: cd waha && docker compose up -d")
        sys.exit(1)

    if args.setup_only:
        print("Session is ready.")
        return

    contacts_path = Path(args.contacts)
    if not contacts_path.exists():
        example = ROOT / "contacts.example.csv"
        print(f"Missing {contacts_path}")
        print(f"Copy {example.name} to contacts.csv and fill in numbers, then re-run.")
        sys.exit(1)

    contacts = load_contacts(contacts_path)
    if not contacts:
        print("No contacts found in CSV.")
        sys.exit(1)

    print(f"Sending to {len(contacts)} contact(s). Delay {DELAY_MIN}-{DELAY_MAX}s between messages.")
    if not args.dry_run:
        confirm = input("Type YES to start sending: ").strip()
        if confirm != "YES":
            print("Aborted.")
            sys.exit(0)

    ok, fail = 0, 0
    for idx, c in enumerate(contacts, start=1):
        text = c["message"] or args.message
        if not text:
            print(f"[{idx}/{len(contacts)}] skip {c['phone']}: no message")
            fail += 1
            continue
        if "{name}" in text and c["name"]:
            text = text.replace("{name}", c["name"])
        try:
            chat_id = to_chat_id(c["phone"])
        except ValueError as e:
            print(f"[{idx}/{len(contacts)}] fail: {e}")
            fail += 1
            continue

        print(f"[{idx}/{len(contacts)}] -> {chat_id} ({c['name'] or 'no name'})")
        if args.dry_run:
            print(f"  DRY RUN: {text[:80]}...")
            ok += 1
        else:
            try:
                send_text(chat_id, text)
                ok += 1
                print("  sent")
            except requests.RequestException as e:
                fail += 1
                print(f"  ERROR: {e}")
            if idx < len(contacts):
                delay = random.uniform(DELAY_MIN, DELAY_MAX)
                time.sleep(delay)

    print(f"Done. ok={ok} fail={fail}")


if __name__ == "__main__":
    main()
