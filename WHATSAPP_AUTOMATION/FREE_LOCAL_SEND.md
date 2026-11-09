# Free local WhatsApp bulk (no Meta Cloud)

Meta Cloud billing/templates are not required for this path.

## Already set up
- Clinic leads synced: ~12,360 phones
- Campaign: **Diwali Membership Offer** (poster + Diwali message), status `paused` until WhatsApp Web is linked
- Poster: `posters/diwali-membership-offer.jpg`
- CRM desk shows **Free local send · WhatsApp Web** panel → `http://127.0.0.1:5178`

## Start services (this PC)
```bat
cd WHATSAPP_AUTOMATION\waha
docker compose up -d

cd ..
start_console.bat
```

## Connect the clinic phone
1. Open http://127.0.0.1:5178 → **Scan & Connect**
2. Keep **WhatsApp 1 / default** Active
3. Phone → Linked devices → Link a device → scan QR
4. Wait until status is **WORKING / Connected**

Or run the auto watcher (test `8137864105` then start paced bulk):
```bat
cd WHATSAPP_AUTOMATION
python -u scripts/watch_qr_then_bulk.py
```

## Pacing
Daily cap 800, delays 8–18s, business hours 09:00–21:00. Resume paused campaigns from the Campaigns tab.
