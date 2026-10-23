@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo First start: installing libraries...
  call npm install
)
echo Starting Asset Forge... keep this window open while you work.
node src\server\index.js
pause
