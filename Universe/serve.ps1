param([int]$Port = 8010)
# Local server for the Data Universe dashboard (localhost only):
#   static files from the project root, dataset downloads into Universe/data with curl.exe,
#   saving the built index, settings, and a pass-through proxy to the Claude API so the key never reaches the page.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = [IO.Path]::GetFullPath((Split-Path -Parent $here))
$dataDir = Join-Path $here 'data'
$indexDir = Join-Path $dataDir '_index'
$settingsPath = Join-Path $here 'settings.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force $indexDir | Out-Null

$types = @{ '.html'='text/html; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css';
  '.md'='text/markdown; charset=utf-8'; '.txt'='text/plain; charset=utf-8'; '.csv'='text/csv; charset=utf-8'; '.xml'='application/xml'; '.pdf'='application/pdf';
  '.json'='application/json; charset=utf-8'; '.htm'='text/html; charset=utf-8'; '.png'='image/png'; '.svg'='image/svg+xml';
  '.xls'='application/vnd.ms-excel'; '.xlsx'='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }

function Get-Catalog { Get-Content (Join-Path $here 'catalog.json') -Raw -Encoding UTF8 | ConvertFrom-Json }
function Get-Settings { if (Test-Path $settingsPath) { Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { New-Object psobject } }
function Write-Utf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, $utf8) }

# Downloads one URL to Dir\Name. Returns a manifest row; failures are recorded, not thrown.
function Save-File([string]$Url, [string]$Dir, [string]$Name, [string]$UserAgent, [hashtable]$Extra) {
  $out = Join-Path $Dir $Name
  $cargs = @('-s', '-L', '--compressed', '--max-time', '180', '-o', $out, '-w', '%{http_code}')
  if ($UserAgent) { $cargs += @('-A', $UserAgent) }
  $code = & curl.exe @cargs $Url
  $bytes = if (Test-Path $out) { (Get-Item $out).Length } else { 0 }
  $ok = ($code -eq '200') -and ($bytes -gt 0)
  if (-not $ok -and (Test-Path $out)) { Remove-Item $out -Force }
  $row = [ordered]@{ name = $Name; url = $Url; ok = $ok; status = "$code"; bytes = $(if ($ok) { $bytes } else { 0 }) }
  if ($Extra) { foreach ($k in $Extra.Keys) { $row[$k] = $Extra[$k] } }
  Write-Host ("  {0} {1} {2}" -f $(if ($ok) { 'ok  ' } else { 'FAIL' }), $code, $Url)
  return $row
}

function Invoke-Download($ds) {
  $dir = Join-Path $dataDir $ds.id
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  New-Item -ItemType Directory -Force $dir | Out-Null
  $files = New-Object System.Collections.ArrayList
  $err = ''
  Write-Host "Downloading $($ds.id)"
  switch ($ds.type) {
    'fred' {
      # FRED's CSV endpoint answers curl's default User-Agent; browser-like agents get throttled.
      foreach ($s in $ds.series) { [void]$files.Add((Save-File "https://fred.stlouisfed.org/graph/fredgraph.csv?id=$($s.id)" $dir "$($s.id).csv" '' @{ series = $s.id })) }
    }
    'files' {
      foreach ($f in $ds.files) {
        $row = Save-File $f.url $dir $f.name '' @{}
        if ($row.ok -and $f.name -like '*.zip') {
          $zipDir = Join-Path $dir ([IO.Path]::GetFileNameWithoutExtension($f.name))
          Expand-Archive -Path (Join-Path $dir $f.name) -DestinationPath $zipDir -Force
          $row['extracted'] = @(Get-ChildItem $zipDir -File | ForEach-Object { "$([IO.Path]::GetFileName($zipDir))/$($_.Name)" })
        }
        [void]$files.Add($row)
      }
    }
    'fomc' {
      $page = Join-Path $dir '_calendar.htm'
      $r = Save-File $ds.page $dir '_calendar.htm' '' @{}
      if ($r.ok) {
        $links = [regex]::Matches((Get-Content $page -Raw), '/newsevents/pressreleases/monetary(\d{8})a\.htm') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique -Descending | Select-Object -First $ds.maxItems
        foreach ($d in $links) { [void]$files.Add((Save-File "https://www.federalreserve.gov/newsevents/pressreleases/monetary$($d)a.htm" $dir "fomc_$d.htm" '' @{ date = "$($d.Substring(0,4))-$($d.Substring(4,2))-$($d.Substring(6,2))" })) }
        Remove-Item $page -Force
      } else { $err = "Could not load the Fed meeting calendar (HTTP $($r.status))." }
    }
    'worldbank' {
      foreach ($ind in $ds.indicators) {
        [void]$files.Add((Save-File "https://api.worldbank.org/v2/country/$($ds.countries)/indicator/$($ind.id)?format=json&per_page=20000&date=$($ds.years)" $dir "$($ind.id).json" '' @{ indicator = $ind.id }))
      }
    }
    'sec13f' {
      $ua = (Get-Settings).secUserAgent
      if (-not $ua) { $err = 'The SEC blocks downloads without a User-Agent naming you and your email. Add it under Settings, then download again.'; break }
      foreach ($m in $ds.managers) {
        $cik10 = '{0:D10}' -f [int64]$m.cik
        $sub = Save-File "https://data.sec.gov/submissions/CIK$cik10.json" $dir "submissions_$($m.cik).json" $ua @{ manager = $m.name }
        [void]$files.Add($sub)
        if (-not $sub.ok) { continue }
        $rec = (Get-Content (Join-Path $dir "submissions_$($m.cik).json") -Raw | ConvertFrom-Json).filings.recent
        $picked = 0
        for ($i = 0; $i -lt $rec.form.Count -and $picked -lt $ds.quarters; $i++) {
          if ($rec.form[$i] -ne '13F-HR') { continue }
          $acc = $rec.accessionNumber[$i]; $accNo = $acc -replace '-', ''
          $base = "https://www.sec.gov/Archives/edgar/data/$($m.cik)/$accNo"
          $idxRow = Save-File "$base/index.json" $dir '_index.json' $ua @{}
          Start-Sleep -Milliseconds 250   # SEC fair access: stay far below 10 requests per second
          if (-not $idxRow.ok) { [void]$files.Add($idxRow); continue }
          $items = (Get-Content (Join-Path $dir '_index.json') -Raw | ConvertFrom-Json).directory.item
          Remove-Item (Join-Path $dir '_index.json') -Force
          $table = $items | Where-Object { $_.name -match '\.xml$' -and $_.name -ne 'primary_doc.xml' } | Sort-Object { [int64]("0$($_.size)" -replace '\D', '') } -Descending | Select-Object -First 1
          if (-not $table) { continue }
          [void]$files.Add((Save-File "$base/$($table.name)" $dir "$($m.cik)_$($rec.reportDate[$i]).xml" $ua @{ manager = $m.name; cik = $m.cik; reportDate = $rec.reportDate[$i]; filingDate = $rec.filingDate[$i]; accession = $acc }))
          Start-Sleep -Milliseconds 250
          $picked++
        }
      }
    }
    'local' {
      $src = Join-Path $here $ds.folder
      New-Item -ItemType Directory -Force $src | Out-Null
      Get-ChildItem $src -File -Recurse | Where-Object { $_.Extension -match '^\.(pdf|txt|md|html?|csv)$' } | ForEach-Object {
        $rel = $_.FullName.Substring($here.Length + 1) -replace '\\', '/'
        [void]$files.Add([ordered]@{ name = $_.Name; path = $rel; ok = $true; status = 'local'; bytes = $_.Length })
      }
      if (-not $files.Count) { $err = "No files yet. Add .pdf, .txt, .md, .html or .csv files to Universe\$($ds.folder), then scan again." }
    }
  }
  $okCount = @($files | Where-Object { $_.ok }).Count
  $manifest = [ordered]@{ id = $ds.id; type = $ds.type; downloadedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss'); okCount = $okCount; failCount = $files.Count - $okCount; error = $err; files = @($files) }
  $json = ConvertTo-Json -InputObject $manifest -Depth 6 -Compress
  Write-Utf8 (Join-Path $dir 'manifest.json') $json
  return $json
}

function Get-StatusJson {
  $parts = @()
  foreach ($ds in (Get-Catalog).datasets) {
    $m = Join-Path (Join-Path $dataDir $ds.id) 'manifest.json'
    if (Test-Path $m) { $parts += ('"' + $ds.id + '":' + (Get-Content $m -Raw -Encoding UTF8)) }
  }
  $s = Get-Settings
  $settings = [ordered]@{
    secUserAgent = "$($s.secUserAgent)"
    apiKeySet = [bool]($env:ANTHROPIC_API_KEY -or $s.anthropicApiKey)
    apiKeySource = $(if ($env:ANTHROPIC_API_KEY) { 'environment' } elseif ($s.anthropicApiKey) { 'settings file' } else { '' })
    model = $(if ($s.model) { "$($s.model)" } else { 'claude-opus-5-5' })
    engine = $(if ($s.engine) { "$($s.engine)" } else { 'open' })
    llmBaseUrl = (Get-LlmBase $s)
    llmModel = $(if ($s.llmModel) { "$($s.llmModel)" } else { $defaultLlmModel })
    llmKeySet = [bool]$s.llmApiKey
    llmKeyless = (Test-Keyless (Get-LlmBase $s))
  }
  $index = @{}
  foreach ($n in 'docs.json', 'series.json', 'model.json') { $p = Join-Path $indexDir $n; if (Test-Path $p) { $index[$n] = (Get-Item $p).LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss') } }
  return '{"datasets":{' + ($parts -join ',') + '},"settings":' + (ConvertTo-Json -InputObject $settings -Compress) + ',"index":' + (ConvertTo-Json -InputObject $index -Compress) + '}'
}

function Save-Settings([string]$Body) {
  $in = $Body | ConvertFrom-Json
  $s = Get-Settings
  $out = [ordered]@{ secUserAgent = "$($s.secUserAgent)"; anthropicApiKey = "$($s.anthropicApiKey)"; model = "$($s.model)"
    engine = "$($s.engine)"; llmBaseUrl = "$($s.llmBaseUrl)"; llmModel = "$($s.llmModel)"; llmApiKey = "$($s.llmApiKey)" }
  if ($null -ne $in.secUserAgent) { $out.secUserAgent = "$($in.secUserAgent)".Trim() }
  if ($in.anthropicApiKey) { $out.anthropicApiKey = "$($in.anthropicApiKey)".Trim() }
  if ($in.clearApiKey) { $out.anthropicApiKey = '' }
  if ($in.model) { $out.model = "$($in.model)" }
  if ($in.engine) { $out.engine = "$($in.engine)" }
  if ($in.llmBaseUrl) { $out.llmBaseUrl = "$($in.llmBaseUrl)".Trim().TrimEnd('/') }
  if ($in.llmModel) { $out.llmModel = "$($in.llmModel)".Trim() }
  if ($in.llmApiKey) { $out.llmApiKey = "$($in.llmApiKey)".Trim() }
  if ($in.clearLlmKey) { $out.llmApiKey = '' }
  Write-Utf8 $settingsPath (ConvertTo-Json -InputObject $out)
}

# Forwards a Messages API request body unchanged and returns the API's status and body.
function Invoke-Claude([string]$Body) {
  $s = Get-Settings
  $key = if ($env:ANTHROPIC_API_KEY) { $env:ANTHROPIC_API_KEY } else { "$($s.anthropicApiKey)" }
  if (-not $key) { return @(400, '{"type":"error","error":{"type":"no_api_key","message":"No Claude API key. Add one under Settings or set ANTHROPIC_API_KEY before starting the server."}}') }
  $client = New-Object System.Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromMinutes(10)
  $msg = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, 'https://api.anthropic.com/v1/messages')
  [void]$msg.Headers.TryAddWithoutValidation('x-api-key', $key)
  [void]$msg.Headers.TryAddWithoutValidation('anthropic-version', '2026-10-21')
  if ($Body -match '"fallbacks"\s*:') { [void]$msg.Headers.TryAddWithoutValidation('anthropic-beta', 'server-side-fallback-2026-07-01') }
  $msg.Content = New-Object System.Net.Http.StringContent($Body, $utf8, 'application/json')
  try {
    $resp = $client.SendAsync($msg).GetAwaiter().GetResult()
    return @([int]$resp.StatusCode, $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult())
  } catch {
    $m = $_.Exception.GetBaseException().Message -replace '[\\"]', "'"
    return @(502, '{"type":"error","error":{"type":"network","message":"' + $m + '"}}')
  } finally { $client.Dispose() }
}

# Default conclusion engine: Pollinations' free anonymous tier, which serves the open-weight GPT-OSS 20B with no key
# (limit: one reply every 30 seconds per IP). Groq, OpenRouter or a custom endpoint need a key.
$defaultLlmBase = 'https://text.pollinations.ai/openai'
$defaultLlmModel = 'openai-fast'
function Get-LlmBase($s) { if ($s.llmBaseUrl) { "$($s.llmBaseUrl)" } else { $defaultLlmBase } }
function Test-Keyless([string]$Base) { $Base -like 'https://text.pollinations.ai/*' }

# Forwards to an OpenAI-compatible provider of open models (Pollinations, Groq, OpenRouter, or any custom endpoint).
# $Path is 'chat/completions' (POST with $Body) or 'models' (GET).
function Invoke-OpenModel([string]$Path, [string]$Body) {
  $s = Get-Settings
  $base = Get-LlmBase $s
  if (-not $s.llmApiKey -and -not (Test-Keyless $base)) { return @(400, '{"error":{"type":"no_api_key","message":"No key for the open-model provider. Add a free key under Settings, or pick Pollinations (no key needed)."}}') }
  $client = New-Object System.Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromMinutes(5)
  $method = if ($Body) { [System.Net.Http.HttpMethod]::Post } else { [System.Net.Http.HttpMethod]::Get }
  $msg = New-Object System.Net.Http.HttpRequestMessage($method, "$base/$Path")
  # A saved key belongs to a keyed provider (Groq, OpenRouter...), so never send it to the keyless endpoint.
  if ($s.llmApiKey -and -not (Test-Keyless $base)) { [void]$msg.Headers.TryAddWithoutValidation('Authorization', "Bearer $($s.llmApiKey)") }
  [void]$msg.Headers.TryAddWithoutValidation('X-Title', 'Data Universe')   # OpenRouter app label; ignored elsewhere
  if ($Body) { $msg.Content = New-Object System.Net.Http.StringContent($Body, $utf8, 'application/json') }
  try {
    $resp = $client.SendAsync($msg).GetAwaiter().GetResult()
    return @([int]$resp.StatusCode, $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult())
  } catch {
    $m = $_.Exception.GetBaseException().Message -replace '[\\"]', "'"
    return @(502, '{"error":{"type":"network","message":"' + $m + '"}}')
  } finally { $client.Dispose() }
}

function Send-Text($Res, [int]$Code, [string]$Text, [string]$Type = 'application/json; charset=utf-8') {
  $b = $utf8.GetBytes($Text)
  $Res.StatusCode = $Code; $Res.ContentType = $Type; $Res.ContentLength64 = $b.Length
  $Res.OutputStream.Write($b, 0, $b.Length)
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Data Universe running at http://localhost:$Port/Universe/  (Ctrl+C to stop)"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  $path = $req.Url.AbsolutePath
  try {
    $body = if ($req.HasEntityBody) { (New-Object IO.StreamReader($req.InputStream, $utf8)).ReadToEnd() } else { '' }
    if ($path -eq '/' -or $path -eq '/Universe') { $res.Redirect('/Universe/') }
    elseif ($path -eq '/api/status') { Send-Text $res 200 (Get-StatusJson) }
    elseif ($path -eq '/api/download' -and $req.HttpMethod -eq 'POST') {
      $id = ($body | ConvertFrom-Json).id
      $ds = (Get-Catalog).datasets | Where-Object { $_.id -eq $id }
      if (-not $ds) { Send-Text $res 404 '{"error":"unknown dataset"}' } else { Send-Text $res 200 (Invoke-Download $ds) }
    }
    elseif ($path -eq '/api/save' -and $req.HttpMethod -eq 'POST') {
      $name = $req.QueryString['name']
      if ($name -notin 'docs.json', 'series.json', 'model.json') { Send-Text $res 400 '{"error":"name not allowed"}' }
      else { Write-Utf8 (Join-Path $indexDir $name) $body; Send-Text $res 200 '{"saved":true}' }
    }
    elseif ($path -eq '/api/settings' -and $req.HttpMethod -eq 'POST') { Save-Settings $body; Send-Text $res 200 (Get-StatusJson) }
    elseif ($path -eq '/api/claude' -and $req.HttpMethod -eq 'POST') { $r = Invoke-Claude $body; Send-Text $res $r[0] $r[1] }
    elseif ($path -eq '/api/llm' -and $req.HttpMethod -eq 'POST') { $r = Invoke-OpenModel 'chat/completions' $body; Send-Text $res $r[0] $r[1] }
    elseif ($path -eq '/api/llm-models') { $r = Invoke-OpenModel 'models' ''; Send-Text $res $r[0] $r[1] }
    else {
      $rel = [Uri]::UnescapeDataString($path.TrimStart('/'))
      $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if ((Test-Path $file -PathType Container)) { $file = Join-Path $file 'index.html' }
      # settings.json holds the API key: never serve it.
      if ($file.StartsWith($root) -and (Split-Path $file -Leaf) -ne 'settings.json' -and (Test-Path $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
        $res.AddHeader('Cache-Control', 'no-store')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else { Send-Text $res 404 'Not found' 'text/plain' }
    }
  } catch {
    Write-Host "ERROR $path : $($_.Exception.Message)"
    try { Send-Text $res 500 ('{"error":' + (ConvertTo-Json -InputObject "$($_.Exception.Message)") + '}') } catch {}
  } finally { $res.Close() }
}
