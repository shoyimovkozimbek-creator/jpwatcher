@echo off
set "AGENT_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "AGENT_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%AGENT_NODE%" -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)" >nul 2>nul
if errorlevel 1 set "AGENT_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%AGENT_NODE%" --require .\bootstrap.cjs -e "require('node:sqlite');require('playwright');"
exit /b %errorlevel%
