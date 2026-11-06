from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

WAHA_BASE_URL = os.getenv("WAHA_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
WAHA_API_KEY = os.getenv("WAHA_API_KEY", "")
WAHA_SESSION = os.getenv("WAHA_SESSION", "default")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
CRM_WORKSPACE_ID = os.getenv("CRM_WORKSPACE_ID", "")

# Anti-block pacing (seconds)
BULK_DELAY_MIN = float(os.getenv("BULK_DELAY_MIN", "8"))
BULK_DELAY_MAX = float(os.getenv("BULK_DELAY_MAX", "18"))
BULK_BATCH_SIZE = int(os.getenv("BULK_BATCH_SIZE", "25"))
BULK_BATCH_PAUSE_MIN = float(os.getenv("BULK_BATCH_PAUSE_MIN", "45"))
BULK_BATCH_PAUSE_MAX = float(os.getenv("BULK_BATCH_PAUSE_MAX", "90"))
DAILY_SEND_CAP = int(os.getenv("DAILY_SEND_CAP", "800"))
HOURLY_SEND_CAP = int(os.getenv("HOURLY_SEND_CAP", "120"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "2"))
ERROR_RATE_PAUSE = float(os.getenv("ERROR_RATE_PAUSE", "0.35"))  # pause if >35% fail in window
ERROR_WINDOW = int(os.getenv("ERROR_WINDOW", "20"))
SEND_START_HOUR = int(os.getenv("SEND_START_HOUR", "9"))   # local business hours
SEND_END_HOUR = int(os.getenv("SEND_END_HOUR", "21"))
RESPECT_BUSINESS_HOURS = os.getenv("RESPECT_BUSINESS_HOURS", "1") not in ("0", "false", "False")

POSTERS_DIR = ROOT / "posters"
DATA_DIR = ROOT / "data"
LEADS_FILE = DATA_DIR / "leads.json"
CAMPAIGNS_FILE = DATA_DIR / "campaigns.json"
TEMPLATES_FILE = DATA_DIR / "templates.json"
SEND_STATS_FILE = DATA_DIR / "send_stats.json"
PROJECTS_FILE = DATA_DIR / "projects.json"

POSTERS_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

LEAD_STATUSES = [
    "new",
    "contacted",
    "interested",
    "follow_up",
    "documents_pending",
    "processing",
    "interview",
    "selected",
    "converted",
    "lost",
    "excel",
    "whatsapp_contact",
]

STATUS_LABELS = {
    "new": "New Lead",
    "contacted": "Contacted",
    "interested": "Interested",
    "follow_up": "Follow-up",
    "documents_pending": "Documents Pending",
    "processing": "Processing",
    "interview": "Interview",
    "selected": "Selected",
    "converted": "Converted",
    "lost": "Not Interested",
    "excel": "Excel Stage",
    "whatsapp_contact": "WhatsApp Contact",
}

# CRM origins that may embed this console (comma-separated)
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173,https://bitvioncrm-drks.netlify.app",
    ).split(",")
    if o.strip()
]

CONSOLE_HOST = os.getenv("CONSOLE_HOST", "127.0.0.1")
CONSOLE_PORT = int(os.getenv("CONSOLE_PORT", "5178"))
