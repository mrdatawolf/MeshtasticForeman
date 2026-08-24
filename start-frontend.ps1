$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version

Write-Host ""
Write-Host "  Meshtastic Foreman — Frontend" -ForegroundColor Cyan
Write-Host "  v$version" -ForegroundColor Gray
Write-Host ""

Set-Location $root
pnpm --filter @foreman/web dev
