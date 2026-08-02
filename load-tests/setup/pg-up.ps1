# Portable PostgreSQL fallback for hosts without Docker/WSL. Downloads the
# EnterpriseDB PostgreSQL 16.x Windows x64 binaries zip (once), initializes a
# local data directory under load-tests/.pg/data, and starts Postgres on
# 127.0.0.1:55432. Idempotent: safe to re-run — skips steps already done.
# Prefer load-tests/docker-compose.yml on Docker-capable hosts; use this only
# where Docker/WSL/Postgres are unavailable and only local admin rights exist.
$ErrorActionPreference = "Stop"

$setupDir = $PSScriptRoot
$pgRoot = Join-Path (Split-Path -Parent $setupDir) ".pg"
$binDir = Join-Path $pgRoot "bin"
$dataDir = Join-Path $pgRoot "data"
$pgCtl = Join-Path $binDir "pg_ctl.exe"

# (a) Fetch + extract the portable binaries if not already present.
if (-not (Test-Path $pgCtl)) {
  Write-Host "[pg-up] portable PostgreSQL binaries not found under $binDir, downloading..."
  New-Item -ItemType Directory -Force $pgRoot | Out-Null
  $zipPath = Join-Path $pgRoot "pg.zip"
  $versions = @("16.9-1", "16.8-1", "16.6-1", "16.4-1")
  $downloaded = $false
  foreach ($v in $versions) {
    $url = "https://get.enterprisedb.com/postgresql/postgresql-$v-windows-x64-binaries.zip"
    Write-Host "[pg-up] trying $url"
    try {
      Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
      $downloaded = $true
      Write-Host "[pg-up] downloaded $v"
      break
    } catch {
      Write-Host "[pg-up] $v unavailable ($($_.Exception.Message)), trying next..."
    }
  }
  if (-not $downloaded) {
    throw "[pg-up] could not download PostgreSQL binaries from any known version URL."
  }

  Write-Host "[pg-up] extracting..."
  $extractDir = Join-Path $pgRoot "extract"
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
  # The zip contains a top-level pgsql/ dir (bin, lib, share, include, ...).
  # Move its contents up so binaries land at load-tests/.pg/bin, with the
  # sibling lib/share dirs pg_ctl/initdb need at their normal relative paths.
  $pgsqlDir = Join-Path $extractDir "pgsql"
  Get-ChildItem $pgsqlDir | ForEach-Object {
    Move-Item -Path $_.FullName -Destination $pgRoot -Force
  }
  Remove-Item $extractDir -Recurse -Force
  Remove-Item $zipPath -Force
  Write-Host "[pg-up] extracted to $pgRoot"
}

# (b) Initialize the data directory if missing.
if (-not (Test-Path $dataDir)) {
  Write-Host "[pg-up] initializing data directory at $dataDir..."
  & (Join-Path $binDir "initdb.exe") -D $dataDir -U postgres -A trust -E UTF8
  if ($LASTEXITCODE -ne 0) { throw "[pg-up] initdb failed with exit code $LASTEXITCODE" }

  $confPath = Join-Path $dataDir "postgresql.conf"
  Add-Content -Path $confPath -Value ""
  Add-Content -Path $confPath -Value "port = 55432"
  Add-Content -Path $confPath -Value "shared_preload_libraries = 'pg_stat_statements'"
  Add-Content -Path $confPath -Value "max_connections = 200"
  Add-Content -Path $confPath -Value "listen_addresses = '127.0.0.1'"
}

# (c) Start it, unless something is already listening on 55432.
$listening = Get-NetTCPConnection -LocalPort 55432 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  Write-Host "[pg-up] something is already listening on 55432, skipping start."
} else {
  Write-Host "[pg-up] starting PostgreSQL..."
  & $pgCtl -D $dataDir -l (Join-Path $pgRoot "pg.log") start
  if ($LASTEXITCODE -ne 0) { throw "[pg-up] pg_ctl start failed with exit code $LASTEXITCODE" }

  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Get-NetTCPConnection -LocalPort 55432 -State Listen -ErrorAction SilentlyContinue) {
      $ready = $true
      break
    }
  }
  if (-not $ready) { throw "[pg-up] PostgreSQL did not start listening on 55432 in time." }
}

# (d) Create the load-test database (idempotent — ignore "already exists").
Write-Host "[pg-up] ensuring database quiz_loadtest exists..."
$createdbOut = & (Join-Path $binDir "createdb.exe") -p 55432 -U postgres quiz_loadtest 2>&1
if ($LASTEXITCODE -ne 0 -and ($createdbOut -notmatch "already exists")) {
  throw "[pg-up] createdb failed: $createdbOut"
}
Write-Host "[pg-up] done. PostgreSQL running on 127.0.0.1:55432 (db quiz_loadtest)."
