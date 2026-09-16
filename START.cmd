@echo off
setlocal
cd /d "%~dp0"
call RUNTIME.cmd
if errorlevel 1 (
  echo Node.js 24+ va Playwright kerak. README_UZ.md ni oching.
  pause
  exit /b 1
)
echo Telegram bot va admin panel ishga tushmoqda.
echo Admin panel: http://127.0.0.1:4173
"%AGENT_NODE%" --require .\bootstrap.cjs server.cjs
pause
