# WaBridge helper:  powershell -ExecutionPolicy Bypass -File windows\manage.ps1 <command>
#   stop     stop everything (your data is kept)
#   start    start again after a stop
#   logs     follow the logs of both containers (Ctrl+C to exit)
#   status   show container status
#   update   pull the newest WhatsApp engine image you pinned in .env and rebuild WaBridge
#   backup   save WaBridge + engine data into .\backups\ (includes WhatsApp logins - keep it private)
#   test     run the end-to-end smoke test inside the WaBridge container
param([Parameter(Position = 0)][string]$Command = 'status')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

switch ($Command) {
  'stop'   { docker compose stop }
  'start'  { docker compose up -d; Start-Process 'http://localhost:8080' }
  'logs'   { docker compose logs -f --tail 100 }
  'status' { docker compose ps }
  'update' { docker compose pull openwa; docker compose up -d --build }
  'backup' {
    New-Item -ItemType Directory -Force -Path backups | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
    $dest = (Resolve-Path backups).Path
    docker run --rm -v wabridge_wabridge-data:/data -v "${dest}:/backup" alpine tar czf "/backup/wabridge-$stamp.tgz" -C /data .
    docker run --rm -v wabridge_openwa-data:/data -v "${dest}:/backup" alpine tar czf "/backup/engine-$stamp.tgz" -C /data .
    Write-Host "Saved to $dest" -ForegroundColor Green
  }
  'test' {
    $email = Read-Host 'Admin email'
    $pass = Read-Host 'Admin password' -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pass))
    docker compose exec -e WB_EMAIL=$email -e WB_PASSWORD=$plain wabridge node --disable-warning=ExperimentalWarning scripts/smoke-test.mjs
  }
  default { Write-Host 'Commands: stop | start | logs | status | update | backup | test' }
}
