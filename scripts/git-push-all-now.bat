@echo off
setlocal EnableDelayedExpansion
cd /d "D:\Bitvion Techzz\BITVION CRM"
set GIT_TERMINAL_PROMPT=0
set REPORT=scripts\_git_push_report.txt

where node >nul 2>&1
if %ERRORLEVEL%==0 (
  node scripts\_git_push_now.mjs
  type "%REPORT%"
  endlocal
  exit /b %ERRORLEVEL%
)

(
echo === git status -sb ===
git status -sb
echo.
echo === git diff --stat ===
git diff --stat
echo.
echo === git log -5 --oneline ===
git log -5 --oneline
echo.
) > "%REPORT%" 2>&1

for /f "delims=" %%F in ('git status --porcelain=v1 -uall') do (
  set "line=%%F"
  set "path=!line:~3!"
  if "!path!"=="" (
    rem skip empty
  ) else (
  for /f "tokens=1,* delims=->" %%A in ("!path!") do if "%%B" neq "" set "path=%%B"
  set "skip=0"
  echo !path! | findstr /i "\.env" >nul && set "skip=1"
  echo !path! | findstr /i "credentials" >nul && set "skip=1"
  if "!path!"=="WHATSAPP_AUTOMATION/qr-diwali.png" set "skip=1"
  if "!path!"=="scripts/.last-backup-smoke.json" set "skip=1"
  if "!path!"=="scripts/.local-backup-daemon.json" set "skip=1"
  if "!path!"=="WHATSAPP_AUTOMATION/scripts/_patch_create_patient.py" set "skip=1"
  if "!path!"=="scripts/_git_push_now.mjs" set "skip=1"
  if "!path!"=="scripts/git-push-all-now.bat" set "skip=1"
  if "!path!"=="scripts/_git_push_report.txt" set "skip=1"
  if "!skip!"=="0" git add -- "!path!"
  )
)

echo.>>"%REPORT%"
echo === staged ===>>"%REPORT%"
git diff --cached --name-only >>"%REPORT%" 2>&1

git commit -m "Add premium backups, local all-day daemon, day-long admin sessions, and reception delete fixes."
set COMMIT_ERR=!ERRORLEVEL!
echo.>>"%REPORT%"
echo === git commit exit !COMMIT_ERR! ===>>"%REPORT%"
git rev-parse HEAD >>"%REPORT%" 2>&1

git push origin HEAD >>"%REPORT%" 2>&1
set PUSH_ERR=!ERRORLEVEL!
if !PUSH_ERR! neq 0 git push origin main >>"%REPORT%" 2>&1

echo.>>"%REPORT%"
echo === git push exit !PUSH_ERR! ===>>"%REPORT%"
echo === push remote URL ===>>"%REPORT%"
git remote get-url origin >>"%REPORT%" 2>&1
echo.>>"%REPORT%"
echo === commit hash ===>>"%REPORT%"
git rev-parse HEAD >>"%REPORT%" 2>&1
echo.>>"%REPORT%"
echo === git status --short ===>>"%REPORT%"
git status --short >>"%REPORT%" 2>&1

type "%REPORT%"
endlocal
