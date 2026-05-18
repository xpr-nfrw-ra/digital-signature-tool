@echo off
REM Launches the signtool server and Prisma Studio in two separate cmd windows.
REM Each window stays open after the command exits so you can see errors.

cd /d "%~dp0digital-signature-tool"

start "signtool: server"        cmd /k "npm start"
start "signtool: prisma studio" cmd /k "npx prisma studio"
