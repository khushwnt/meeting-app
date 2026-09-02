@echo off
REM =============================================================================
REM Start Telemedicine App - Full Stack (HTTPS for Network Access)
REM =============================================================================
REM This script starts both the Flask backend and Vite frontend with HTTPS
REM for testing across your local network.
REM =============================================================================

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║     TELEMEDICINE APP - STARTING SERVERS                   ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM Get the IP address for display
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        set IP=%%b
        goto :found
    )
)
:found

echo Your IP Address: %IP%
echo.

REM Check if backend certificates exist
if not exist "backend\cert.pem" (
    echo [!] Backend SSL certificates not found!
    echo [!] Generating certificates...
    echo.
    cd backend
    call generate-cert.bat
    cd ..
    echo.
)

REM Check if frontend certificates exist
if not exist "cert.pem" (
    echo [!] Frontend SSL certificates not found!
    echo [!] Installing dependencies to generate...
    echo.
    call npm install
    echo.
)

echo ╔═══════════════════════════════════════════════════════════╗
echo ║     STEP 1: STARTING FLASK BACKEND                        ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.
echo Backend will run on:
echo   - https://localhost:5000
echo   - https://%IP%:5000
echo.
echo Starting Flask in a new window...
echo.

start "Flask Backend (HTTPS)" cmd /k "cd backend && python app.py --ssl"

REM Wait for backend to start
echo Waiting 3 seconds for backend to initialize...
timeout /t 3 /nobreak >nul

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║     STEP 2: STARTING VITE FRONTEND                        ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.
echo Frontend will run on:
echo   - https://localhost:5173
echo   - https://%IP%:5173
echo.
echo Starting Vite...
echo.
echo ═══════════════════════════════════════════════════════════
echo.
echo ACCESS URLS:
echo   Local:   https://localhost:5173
echo   Network: https://%IP%:5173
echo.
echo On your mobile/other device, open:
echo   https://%IP%:5173
echo.
echo Accept the SSL certificate warning in your browser.
echo ═══════════════════════════════════════════════════════════
echo.

call npm run dev
