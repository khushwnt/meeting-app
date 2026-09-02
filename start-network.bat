@echo off
REM ============================================================================
REM TELEMEDICINE APP - NETWORK ACCESS STARTUP SCRIPT
REM ============================================================================
REM This script starts both backend and frontend for network access
REM
REM Your Network IP: 192.168.4.190
REM Others can join at: http://192.168.4.190:5173
REM ============================================================================

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║     TELEMEDICINE APP - NETWORK MODE                        ║
echo ║                                                            ║
echo ║  Your IP Address: 192.168.4.190                           ║
echo ║                                                            ║
echo ║  Backend (Signaling): http://192.168.4.190:5000           ║
echo ║  Frontend (React):    http://192.168.4.190:5173           ║
echo ║                                                            ║
echo ║  Share this URL with others on your network:              ║
echo ║  → http://192.168.4.190:5173/?room=CONSULT-123            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

REM Check if Python dependencies are installed
echo [1/4] Checking Python dependencies...
pip show flask-socketio >nul 2>&1
if errorlevel 1 (
    echo Installing Python dependencies...
    cd backend
    pip install -r requirements.txt
    cd ..
) else (
    echo ✓ Flask-SocketIO already installed
)

REM Check if Node dependencies are installed
echo.
echo [2/4] Checking Node dependencies...
if not exist "node_modules\socket.io-client" (
    echo Installing Node dependencies...
    npm install socket.io-client
) else (
    echo ✓ socket.io-client already installed
)

REM Start backend in a new window
echo.
echo [3/4] Starting Flask-SocketIO backend...
start "Telemedicine Backend" cmd /k "cd backend && python app.py"
timeout /t 3 /nobreak >nul

REM Start frontend
echo.
echo [4/4] Starting React frontend...
start "Telemedicine Frontend" cmd /k "npm run dev"

echo.
echo ════════════════════════════════════════════════════════════
echo ✓ Both servers starting...
echo.
echo IMPORTANT: Allow through Windows Firewall if prompted!
echo.
echo To test locally:  http://localhost:5173/?room=TEST-123
echo To share:         http://192.168.4.190:5173/?room=TEST-123
echo ════════════════════════════════════════════════════════════
echo.
pause
