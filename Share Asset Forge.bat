@echo off
cd /d "%~dp0"
echo Share Asset Forge with other computers on your network (friends, a second PC, AIs elsewhere).
echo They will need a password. Choose one of at least 8 characters.
echo.
set /p FORGE_PASSWORD=Password:
set FORGE_HOST=0.0.0.0
echo.
echo Starting... keep this window open. Others open one of the addresses shown below.
node src\server\index.js
pause
