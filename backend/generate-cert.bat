@echo off
REM =============================================================================
REM Generate Self-Signed SSL Certificate for Local Development
REM =============================================================================
REM This script generates a self-signed certificate for HTTPS testing.
REM 
REM REQUIREMENTS:
REM - OpenSSL for Windows (install from: https://slproweb.com/products/Win32OpenSSL.html)
REM   OR use Git Bash which includes OpenSSL
REM
REM USAGE:
REM   generate-cert.bat
REM =============================================================================

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║     GENERATING SSL CERTIFICATE FOR LOCAL DEVELOPMENT      ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM Check if OpenSSL is available
where openssl >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] OpenSSL not found in PATH!
    echo.
    echo Please install OpenSSL:
    echo   1. Download from: https://slproweb.com/products/Win32OpenSSL.html
    echo   2. Or use Git Bash which includes OpenSSL
    echo   3. Or run: choco install openssl  (if you have Chocolatey)
    echo.
    pause
    exit /b 1
)

echo [OK] OpenSSL found
echo.

REM Generate the certificate
echo Generating self-signed certificate...
echo.

openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ╔═══════════════════════════════════════════════════════════╗
    echo ║     CERTIFICATE GENERATED SUCCESSFULLY!                   ║
    echo ╚═══════════════════════════════════════════════════════════╝
    echo.
    echo Files created:
    echo   - cert.pem  (certificate)
    echo   - key.pem   (private key)
    echo.
    echo USAGE:
    echo   python app.py --ssl
    echo.
    echo Then access your app via:
    echo   https://localhost:5173
    echo   https://YOUR-IP:5173
    echo.
    echo NOTE: Your browser will show a security warning for self-signed
    echo       certificates. Click "Proceed" or "Accept Risk" to continue.
    echo.
) else (
    echo.
    echo [ERROR] Failed to generate certificate!
    echo.
)

pause
