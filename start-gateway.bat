@echo off
setlocal
cd /d "%~dp0"

title Copilot API Gateway
echo ================================================
echo  Copilot API Gateway  (Copilot + Doubao + Ali)
echo ================================================
echo.

where bun >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Bun is not installed or not on PATH.
    echo         Install it with:  npm install -g bun@1.3.14
    echo.
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies, this may take a minute...
    call bun install
    echo.
)

echo Starting gateway on http://localhost:4141
echo Close this window to stop the server.
echo.

set NODE_USE_SYSTEM_CA=1
set NODE_ENV=production
bun run ./src/main.ts start

echo.
echo Server stopped.
pause
