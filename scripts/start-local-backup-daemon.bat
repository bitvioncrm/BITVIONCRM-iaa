@echo off
cd /d "%~dp0\.."
set SUPABASE_SKIP_SSL_VERIFY=1
set BACKUP_INTERVAL_MIN=180
set BACKUP_START_HOUR=9
set BACKUP_END_HOUR=21
echo Starting local Premium Backup daemon (clinic + institute)...
echo Interval %BACKUP_INTERVAL_MIN% minutes, hours %BACKUP_START_HOUR%:00-%BACKUP_END_HOUR%:00
node scripts\local-backup-daemon.mjs
pause
