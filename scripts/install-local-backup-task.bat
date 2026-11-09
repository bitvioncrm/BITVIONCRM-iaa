@echo off
REM Registers a Windows Scheduled Task that keeps the backup daemon running during the day.
set ROOT=%~dp0..
set TASK=BitvionCRM-LocalBackup
schtasks /Delete /TN "%TASK%" /F >nul 2>&1
schtasks /Create /TN "%TASK%" /SC DAILY /ST 09:00 /RI 180 /DU 12:00 /TR "\"%ROOT%\scripts\start-local-backup-daemon.bat\"" /RL LIMITED
if errorlevel 1 (
  echo Could not create scheduled task. Run this bat as Administrator.
  pause
  exit /b 1
)
echo Scheduled task "%TASK%" created: every 3 hours from 09:00 for 12 hours.
pause
