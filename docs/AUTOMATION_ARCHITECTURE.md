# Automation

Rules are rows, not hardcoded clinic logic.

```
Event → rule match → conditions → actions → automation_runs
```

Events include lead created, stage changed, follow-up date reached, stock under minimum, admission created, document uploaded, invoice overdue.

Example rule, stored as data:

- If workspace module is clinic, source is Meta, stage is New: assign the configured BDE, create a follow-up, and send the approved WhatsApp template only when WhatsApp status is connected.

If WhatsApp is not connected, the assign and follow-up actions still run. The message action records `skipped` with reason `configuration_required`.

A customer reply sets a flag that stops later automated WhatsApp steps for that lead. Every send stores template name, lead id, and provider message id when the adapter returns one.

## Jobs

Database table `jobs`: type, payload, status, error, retry_count, last_attempt, next_attempt. Types include import batch, export, file optimize, automation action, webhook ingest, notification.

A Netlify scheduled function or a manual Super Admin "run due jobs" action claims rows with `for update skip locked` equivalent logic (claim by status flip). The UI never waits on a large import.

## Notifications

In-app only. Rows in `notifications` with unread state. No email and no SMS. Inventory, payment, appointment, and follow-up alerts are notification rows.
