# Starts Asset Forge like a normal program: the engine runs invisibly in the background and
# the window opens as its own app (no browser tabs or address bar). Used by the shortcuts.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$url = 'http://127.0.0.1:7777'

function Test-Engine {
  try { (Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

if (-not (Test-Engine)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Asset Forge needs Node.js. Install it from https://nodejs.org and try again.', 'Asset Forge') | Out-Null
    exit 1
  }
  if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm install' -WorkingDirectory $root -Wait -WindowStyle Hidden
  }
  # the engine stops by itself 10 minutes after the last window closes
  Start-Process -FilePath $node -ArgumentList 'src/server/index.js', '--no-open', '--idle-exit=10' -WorkingDirectory $root -WindowStyle Hidden
  for ($i = 0; $i -lt 60 -and -not (Test-Engine); $i++) { Start-Sleep -Milliseconds 250 }
}

$browsers = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) }

if ($browsers) {
  Start-Process -FilePath $browsers[0] -ArgumentList "--app=$url", '--window-size=1500,920'
} else {
  Start-Process $url
}
