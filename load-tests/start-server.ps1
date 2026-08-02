# Starts the PRODUCTION build with the monitor agent preloaded.
# Usage (from repo root):  npm run build  ;  .\load-tests\start-server.ps1
$root = Split-Path -Parent $PSScriptRoot
Get-Content (Join-Path $PSScriptRoot ".env.loadtest") | ForEach-Object {
  if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$') {
    Set-Item -Path ("Env:" + $Matches[1]) -Value $Matches[2]
  }
}
$env:NODE_ENV = "production"
$agent = (Join-Path $PSScriptRoot "monitor\agent.mjs") -replace '\\', '/'
# Quote the file:/// URL inside NODE_OPTIONS: this repo's path contains a
# space ("PDO Quiz"), and Node tokenizes NODE_OPTIONS on whitespace, so an
# unquoted value would split into two bogus tokens.
$env:NODE_OPTIONS = "--import `"file:///$agent`""
$env:LOADTEST_AGENT_OUT = Join-Path $PSScriptRoot "results\agent.ndjson"
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot "results") | Out-Null
Write-Host "Starting production server on port $env:PORT (agent -> $env:LOADTEST_AGENT_OUT)"
node (Join-Path $root "dist\index.js")
