@echo off
REM First-time setup for the signtool project (run this once after cloning).
REM Installs dependencies, applies database migrations, and generates the
REM self-signed HTTPS certificate used by the `main` branch.

cd /d "%~dp0digital-signature-tool"

echo === [1/3] Installing npm dependencies ===
call npm install
if errorlevel 1 goto :fail

echo.
echo === [2/3] Applying Prisma migrations (creates dev.db) ===
call npx prisma migrate deploy
if errorlevel 1 goto :fail

echo.
echo === [3/3] Generating self-signed HTTPS certificate ===
call npm run generate-certs
if errorlevel 1 (
    echo.
    echo Cert generation skipped or failed - this is normal on the http-demo branch.
)

echo.
echo === Setup complete. Run start.bat to launch the server and Prisma Studio. ===
exit /b 0

:fail
echo.
echo === Setup FAILED. See the error above. ===
exit /b 1
