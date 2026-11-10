# WaBridge one-click setup & start for Windows (Docker Desktop).
# Run from the WaBridge folder:  powershell -ExecutionPolicy Bypass -File windows\setup.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function New-Secret([int]$bytes = 24) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  ($b | ForEach-Object { $_.ToString('x2') }) -join ''
}

Write-Step 'Checking Docker Desktop'
try { docker version --format '{{.Server.Version}}' | Out-Null }
catch {
  Write-Host 'Docker is not running. Start Docker Desktop (whale icon in the tray), wait until it says "Engine running", then run this again.' -ForegroundColor Red
  exit 1
}
docker compose version | Out-Null

Write-Step 'Preparing .env'
if (-not (Test-Path '.env')) {
  $text = Get-Content '.env.example' -Raw
  $text = $text -replace '(?m)^OPENWA_API_KEY=.*$', ('OPENWA_API_KEY=owa_' + (New-Secret 24))
  $text = $text -replace '(?m)^WABRIDGE_SECRET=.*$', ('WABRIDGE_SECRET=' + (New-Secret 32))
  $text = $text -replace '(?m)^OPENWA_API_KEY_PEPPER=.*$', ('OPENWA_API_KEY_PEPPER=' + (New-Secret 24))
  # UTF-8 without BOM so Docker Compose reads the first line correctly.
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host 'Created .env with fresh random secrets.' -ForegroundColor Green
} else {
  Write-Host '.env already exists - keeping your settings.'
}

Write-Step 'Building and starting WaBridge + WhatsApp engine (first run downloads ~1 GB, takes a few minutes)'
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Write-Host 'docker compose failed - see the messages above.' -ForegroundColor Red; exit 1 }

Write-Step 'Waiting for WaBridge to answer on http://localhost:8080'
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8080/healthz' -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if (-not $ok) {
  Write-Host 'WaBridge did not start in time. Check: docker compose logs --tail 100' -ForegroundColor Yellow
  exit 1
}

Write-Host "`nWaBridge is running:  http://localhost:8080" -ForegroundColor Green
Write-Host 'First visit: create your admin account, then go to WhatsApp numbers -> Add number -> scan the QR.'
Start-Process 'http://localhost:8080'
