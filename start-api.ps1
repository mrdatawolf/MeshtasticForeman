$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version

Write-Host ""
Write-Host "  Meshtastic Foreman — API Daemon" -ForegroundColor Cyan
Write-Host "  v$version" -ForegroundColor Gray
Write-Host ""

Set-Location $root

while ($true) {
    pnpm --filter @foreman/daemon dev
    $code = $LASTEXITCODE
    Write-Host ""
    Write-Host "  Daemon exited (code $code) — restarting..." -ForegroundColor Yellow
    Write-Host ""
    Start-Sleep -Seconds 1
}
