# Puts "Asset Forge" shortcuts with its own icon on the desktop and in the Start menu.
# Run again any time; it simply overwrites them. Remove them by deleting the shortcuts.
$root = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) '')
)
foreach ($folder in $targets) {
  $lnk = $shell.CreateShortcut((Join-Path $folder 'Asset Forge.lnk'))
  $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\launch.ps1`""
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$root\assets\icon.ico,0"
  $lnk.Description = 'Asset Forge: our own AI-controllable asset creation tool'
  $lnk.WindowStyle = 7
  $lnk.Save()
  Write-Output "Created $(Join-Path $folder 'Asset Forge.lnk')"
}
