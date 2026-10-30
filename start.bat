@echo off
REM Starts the app at https://localhost:3443. Same as running "npm run dev" in a terminal.
REM Press Ctrl+C to stop it (then Y if asked "Terminate batch job?").

title Digital Signature Tool
cd /d "%~dp0"
call npm run dev

echo.
pause
