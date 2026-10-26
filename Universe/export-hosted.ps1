# Writes the read-only snapshot that the GitHub Pages copy loads: Universe\hosted\{docs,series,model,status}.json.
# Leaves out datasets whose full text may not be republished (the Berkshire letters) and every setting (no email, no keys).
# Run after Build & train:  powershell -ExecutionPolicy Bypass -File Universe\export-hosted.ps1
param([string[]]$Exclude = @('berkshire-letters'))

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
$root = $PSScriptRoot
$indexDir = Join-Path $root 'data\_index'
$outDir = Join-Path $root 'hosted'
New-Item -ItemType Directory -Force $outDir | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$json.MaxJsonLength = [int]::MaxValue
# Values are kept as plain .NET objects throughout: PowerShell wrappers (New-Object, function returns) break the serializer.
function Read-Json([string]$Path) { $json.DeserializeObject([IO.File]::ReadAllText($Path, $utf8)) }

foreach ($name in 'docs.json', 'series.json') {
  $all = Read-Json (Join-Path $indexDir $name)
  $list = New-Object 'System.Collections.Generic.List[object]'
  foreach ($x in $all) { if ($Exclude -notcontains $x['dataset']) { $list.Add($x) } }
  [IO.File]::WriteAllText((Join-Path $outDir $name), $json.Serialize($list), $utf8)
  "${name}: kept $($list.Count) of $($all.Count)"
}
Copy-Item (Join-Path $indexDir 'model.json') (Join-Path $outDir 'model.json') -Force

# Dataset cards show what was downloaded; the settings are blank so no email or key is published.
$parts = @()
foreach ($ds in (Read-Json (Join-Path $root 'catalog.json'))['datasets']) {
  $id = $ds['id']; $m = Join-Path $root "data\$id\manifest.json"
  if ($Exclude -contains $id -or -not (Test-Path $m)) { continue }
  $parts += '"' + $id + '":' + $json.Serialize((Read-Json $m))
}
$now = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
$status = '{"datasets":{' + ($parts -join ',') + '},"settings":{"secUserAgent":"","apiKeySet":false,"apiKeySource":"","model":"","engine":"search","llmBaseUrl":"","llmModel":"","llmKeySet":false,"llmKeyless":false},' +
  '"index":{"docs.json":"' + $now + '","series.json":"' + $now + '","model.json":"' + $now + '"}}'
[void]$json.DeserializeObject($status)
[IO.File]::WriteAllText((Join-Path $outDir 'status.json'), $status, $utf8)
Get-ChildItem $outDir | ForEach-Object { '{0,-12} {1,8:N0} KB' -f $_.Name, ($_.Length / 1KB) }
