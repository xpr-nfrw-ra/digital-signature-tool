@echo off
REM First-time setup for the signtool project (run this once after cloning).
REM Creates .env, installs dependencies, applies database migrations, and
REM generates the local Root CA -> Intermediate CA -> server certificate chain.

cd /d "%~dp0"

echo === [1/4] Installing npm dependencies ===
call npm install
if errorlevel 1 goto :fail

echo.
echo === [2/4] Creating .env with a random SESSION_SECRET ===
if exist ".env" (
    echo .env already exists - leaving it untouched.
) else (
    node -e "const fs=require('fs');const s=require('crypto').randomBytes(32).toString('hex');fs.writeFileSync('.env',fs.readFileSync('.env.example','utf8').replace(/^SESSION_SECRET=.*$/m,'SESSION_SECRET='+s))"
    if errorlevel 1 goto :fail
)

echo.
echo === [3/4] Applying Prisma migrations (creates dev.db) ===
call npx prisma migrate deploy
if errorlevel 1 goto :fail

echo.
echo === [4/4] Generating HTTPS certificate chain (requires bash + openssl) ===
call npm run generate-ca-chain
if errorlevel 1 goto :fail

echo.
echo === Setup complete. Run start.bat to launch the server and Prisma Studio. ===
exit /b 0

:fail
echo.
echo === Setup FAILED. See the error above. ===
exit /b 1
