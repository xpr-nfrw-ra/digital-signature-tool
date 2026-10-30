@echo off
REM First-time setup. Same as running "npm run setup" in a terminal.
REM Safe to run again - steps that are already done are skipped.

cd /d "%~dp0"
call npm run setup

echo.
pause
