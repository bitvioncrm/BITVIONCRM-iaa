@echo off
setlocal
cd /d "D:\Bitvion Techzz\BITVION CRM"
set GIT_TERMINAL_PROMPT=0
node scripts\_push_fast.mjs
endlocal & exit /b %ERRORLEVEL%
