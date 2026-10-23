@echo off
cd /d "%~dp0"
echo Installing Asset Forge shortcuts (desktop and Start menu)...
if not exist node_modules call npm install
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-shortcuts.ps1"
echo.
echo Done. Start Asset Forge from the desktop or the Start menu.
pause
