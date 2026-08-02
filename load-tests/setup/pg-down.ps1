# Stops the portable PostgreSQL instance started by pg-up.ps1.
$setupDir = $PSScriptRoot
$pgRoot = Join-Path (Split-Path -Parent $setupDir) ".pg"
$dataDir = Join-Path $pgRoot "data"
& (Join-Path $pgRoot "bin\pg_ctl.exe") -D $dataDir stop
if ($LASTEXITCODE -ne 0) {
  Write-Warning "[pg-down] pg_ctl stop exited with code $LASTEXITCODE"
}
