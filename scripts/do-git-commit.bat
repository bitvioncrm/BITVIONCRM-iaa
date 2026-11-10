@echo off
setlocal
cd /d "D:\Bitvion Techzz\BITVION CRM"
set GIT_TERMINAL_PROMPT=0

echo === git status ===
git status -sb
echo === git diff --stat ===
git diff --stat
echo === git log -5 ===
git log -5 --oneline

git add -- .gitignore
git add -- src/context/AuthContext.tsx src/pages/LoginPage.tsx src/lib/supabase.ts
git add -- src/components/settings/PremiumBackups.tsx src/services/workspace-backups.ts
git add -- scripts/local-backup-daemon.mjs scripts/start-local-backup-daemon.bat scripts/install-local-backup-task.bat scripts/test-workspace-backup.mjs
git add -- netlify/functions/backup-daily.ts netlify/lib/workspace-backup-core.ts netlify.toml
git add -- supabase/migrations/20261109150000_workspace_backups.sql supabase/migrations/20261109143000_soft_delete_patient.sql
git add -- src/pages/production/ProductionOpsPages.tsx src/pages/production/ProductionModule.tsx src/pages/production/ProductionDashboard.tsx
git add -- src/services/production-ops.ts
git add -- src/pages/production/ProductionWhatsApp.tsx
git add -- WHATSAPP_AUTOMATION/FREE_LOCAL_SEND.md
git add -- WHATSAPP_AUTOMATION/posters/diwali-membership-offer.jpg
git add -- WHATSAPP_AUTOMATION/scripts/seed_diwali_campaign.py WHATSAPP_AUTOMATION/scripts/watch_qr_then_bulk.py WHATSAPP_AUTOMATION/scripts/test_and_start_diwali.py
git add -- WHATSAPP_AUTOMATION/data/accounts.json WHATSAPP_AUTOMATION/data/projects.json
git add -- WHATSAPP_AUTOMATION/app/main.py WHATSAPP_AUTOMATION/app/waha_client.py

git commit -m "Add premium clinic/institute backups with local all-day daemon and day-long admin sessions."
git push -u origin HEAD

echo === staged ===
git diff --cached --name-only
echo === hash ===
git rev-parse HEAD
echo === final status ===
git status -sb
