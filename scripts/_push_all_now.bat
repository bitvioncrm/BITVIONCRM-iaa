@echo off
setlocal EnableDelayedExpansion
cd /d "D:\Bitvion Techzz\BITVION CRM"
set GIT_TERMINAL_PROMPT=0
set REPORT=scripts\_git_push_report.txt

echo === push all start %DATE% %TIME% === > "%REPORT%"

where git >> "%REPORT%" 2>&1
git status -sb >> "%REPORT%" 2>&1
git log -5 --oneline >> "%REPORT%" 2>&1

git add -A
git reset HEAD -- .env .env.* *.pem *.key 2>nul
git reset HEAD -- WHATSAPP_AUTOMATION/qr-diwali.png 2>nul
git reset HEAD -- scripts/.last-backup-smoke.json 2>nul
git reset HEAD -- scripts/.local-backup-daemon.json 2>nul
git reset HEAD -- scripts/_git_push_report.txt 2>nul
git reset HEAD -- scripts/_push_stdout.txt 2>nul
git reset HEAD -- scripts/_push_stderr.txt 2>nul

echo.>>"%REPORT%"
echo === staged ===>>"%REPORT%"
git diff --cached --name-only >> "%REPORT%" 2>&1

git commit -m "Push clinic doctor names, admin backups vault, and desk assignment fixes." >> "%REPORT%" 2>&1
set COMMIT_ERR=!ERRORLEVEL!
echo commit exit !COMMIT_ERR! >> "%REPORT%"

git push origin HEAD >> "%REPORT%" 2>&1
set PUSH_ERR=!ERRORLEVEL!
if !PUSH_ERR! neq 0 (
  git push origin main >> "%REPORT%" 2>&1
  set PUSH_ERR=!ERRORLEVEL!
)
if !PUSH_ERR! neq 0 (
  git push previous HEAD:main >> "%REPORT%" 2>&1
  set PUSH_ERR=!ERRORLEVEL!
)

echo push exit !PUSH_ERR! >> "%REPORT%"
git rev-parse HEAD >> "%REPORT%" 2>&1
git status -sb >> "%REPORT%" 2>&1
echo === push all done === >> "%REPORT%"
type "%REPORT%"
endlocal
exit /b %PUSH_ERR%
