@echo off
setlocal
cd /d "%~dp0"
call RUNTIME.cmd
if errorlevel 1 exit /b 1
echo Lokal testlar: haqiqiy bron va Telegram xabari yuborilmaydi.
"%AGENT_NODE%" --require .\bootstrap.cjs --test --test-isolation=none --test-timeout=90000 tests/*.test.cjs > test-results.txt 2>&1
set "AGENT_TEST_EXIT=%errorlevel%"
type test-results.txt
if not "%AGENT_TEST_EXIT%"=="0" echo TESTLAR MUVAFFAQIYATSIZ.
pause
exit /b %AGENT_TEST_EXIT%
