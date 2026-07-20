param([Parameter(Mandatory = $true)][string[]]$Files)
$ErrorActionPreference = 'Stop'
$forbidden = @(
  'ISO[- ]?\s*(9001|27001)?\s*certified', 'SOC\s*2?\s*(Type)?\s*(1|2|I|II)?\s*certified',
  'zero\s+downtime', 'no\s+data\s+loss', 'unlimited\s+scalab',
  'guarantee[ds]?\s+(100\s*%|zero|uptime|resolution)',
  'penetration\s+test(ing)?\s+(has\s+been|was)\s+(completed|performed)',
  'fully\s+compliant\s+with', 'معتمد\w*\s+من\s+(الآيزو|ISO)', 'بدون\s+أي\s+توقف', 'نضمن\s+عدم'
)
$fail = $false
foreach ($f in $Files) {
  $text = Get-Content (Resolve-Path $f) -Raw
  foreach ($p in $forbidden) {
    if ($text -match $p) { Write-Output "FORBIDDEN pattern '$p' found in $f"; $fail = $true }
  }
}
if ($fail) { exit 1 } else { Write-Output 'CLAIMS LINT OK' }
