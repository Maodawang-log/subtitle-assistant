$ErrorActionPreference = 'Stop'
$recordPath = Join-Path $PSScriptRoot 'managed-service.json'
$record = Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8 | ConvertFrom-Json
$ownedPid = [int]$record.pid
$owned = Get-Process -Id $ownedPid -ErrorAction Stop
$details = Get-CimInstance Win32_Process -Filter "ProcessId=$ownedPid"
$expectedServer = Join-Path $PSScriptRoot 'service\server.py'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'host-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$expectedPython = Join-Path $config.legacyBase '.venv\Scripts\python.exe'
if ($record.server -ne $expectedServer -or $record.python -ne $expectedPython -or $details.ExecutablePath -ne $expectedPython -or !$details.CommandLine.Contains($expectedServer) -or $owned.StartTime.ToUniversalTime().ToFileTimeUtc() -ne [long]$record.stamp) { throw 'Service identity changed; nothing stopped.' }
$portNumber = [int]$record.port
if ($portNumber -lt 1024 -or $portNumber -gt 65535) { throw 'Invalid local port.' }
$request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$portNumber/health")
$request.Proxy = $null; $request.Timeout = 2000
$response = $request.GetResponse()
try { $reader = New-Object System.IO.StreamReader($response.GetResponseStream()); try { $health = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() } } finally { $response.Dispose() }
if ($health.manager_instance -ne $record.instance -or $health.active -or $health.queue -gt 0 -or $health.other_consumer_recent) { throw 'Service is busy or shared; nothing stopped.' }
$frontier = @($ownedPid); $childrenToStop = @()
for ($depth=0; $depth -lt 5 -and $frontier.Count -gt 0; $depth++) {
 $next = @()
 foreach ($parentPid in $frontier) {
  foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$parentPid")) {
   if ($child.Name -like 'python*.exe' -and ($child.CommandLine.Contains($expectedServer) -or $child.CommandLine.Contains('multiprocessing.spawn') -or $child.CommandLine.Contains('multiprocessing.resource_tracker'))) { $childrenToStop += [int]$child.ProcessId; $next += [int]$child.ProcessId }
  }
 }
 $frontier = $next
}
[array]::Reverse($childrenToStop)
foreach ($childPid in $childrenToStop) { Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue }
Stop-Process -Id $ownedPid -Force
Remove-Item -LiteralPath $recordPath
