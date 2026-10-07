# Zero-cost architecture

The core product runs on free tiers. Paid plans are not required for login, CRM, clinic ERP, institute ERP, files within the free storage cap, or in-app notifications.

| Need | Choice | Cost |
| --- | --- | --- |
| App host | Netlify free site, `netlify.app` hostname | ₹0 |
| Database, auth, storage, realtime | Supabase free project | ₹0 |
| Repository | GitHub | ₹0 |
| Meta Lead Ads and Instagram messaging API | Official Meta app, no BITVION fee | ₹0 to BITVION. Ad spend and WhatsApp conversation fees bill the client's Meta account |
| Payments | Recorded in Postgres. No gateway | ₹0 |
| Calls | Browser `tel:` plus a timer. No telephony vendor | ₹0 |
| Email and SMS | Not built | — |
| Search and reports | Postgres indexes and SQL | ₹0 |
| File optimization | Browser `createImageBitmap` / canvas for images. Original bytes kept when the category requires it | ₹0 |
| AI | Optional and off by default | ₹0 while disabled |

## Free-tier limits to design for

Supabase free is about 500 MB database and 1 GB file storage, and an idle project can pause. The app paginates leads, stores checksums so the same file is not uploaded twice, and compresses marketing images. A **System cost and usage** screen reads storage and row estimates and warns near the free cap. It never upgrades a plan by itself.

Daily managed backups are not on the free project. Until a backup add-on is chosen, a Super Admin export (SQL or CSV of business tables) is the recovery copy. That limit is stated in the product. It is not hidden.

## What stays out

No PaymentAdapter, TelephonyAdapter, email provider, or SMS provider. WhatsApp, Meta, and AI are adapters. Disconnecting them does not stop leads, patients, invoices, or call-time totals.
