$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version

Write-Host ""
Write-Host "  Meshtastic Foreman v$version" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Starting API daemon..." -ForegroundColor Yellow

Start-Process pwsh -ArgumentList @(
    "-NoExit",
    "-WorkingDirectory", $root,
    "-Command", "& '$root\start-api.ps1'"
)

Write-Host "  Waiting 3s for daemon to initialise..." -ForegroundColor DarkGray
Start-Sleep -Seconds 3

Write-Host "  Starting frontend..." -ForegroundColor Yellow

Start-Process pwsh -ArgumentList @(
    "-NoExit",
    "-WorkingDirectory", $root,
    "-Command", "& '$root\start-frontend.ps1'"
)

Write-Host ""
Write-Host "  Both services launched in separate windows." -ForegroundColor Green
Write-Host ""
