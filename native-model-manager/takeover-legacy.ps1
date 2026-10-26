$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'host-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$base = $config.legacyBase
$recordPath = Join-Path $base 'service.pid.json'
$record = Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8 | ConvertFrom-Json
$expectedPython = Join-Path $base '.venv\Scripts\python.exe'
$expectedScript = Join-Path $base 'server.py'
$ownedPid = [int]$record.pid
function Assert-Identity {
 $owned = Get-Process -Id $ownedPid -ErrorAction Stop
 $details = Get-CimInstance Win32_Process -Filter "ProcessId=$ownedPid"
 if ($record.python -ne $expectedPython -or $record.script -ne $expectedScript -or $owned.StartTime.ToUniversalTime().Ticks -ne [long]$record.startTicks -or $details.ExecutablePath -ne $expectedPython -or !$details.CommandLine.Contains($expectedScript)) { throw 'Legacy process identity mismatch.' }
}
function Read-Health {
 $request = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:18766/health');$request.Proxy=$null;$request.Timeout=1500
 $response=$request.GetResponse()
 try { $reader=New-Object System.IO.StreamReader($response.GetResponseStream());try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() } } finally { $response.Dispose() }
}
Assert-Identity
$before=Read-Health
if ($before.service -ne 'local-japanese-asr' -or $before.base_path -ne $base -or $before.active -or $before.queue -gt 0) { throw 'Legacy service is busy or not recognized.' }
Start-Sleep -Milliseconds 2000
$after=Read-Health
Assert-Identity
if ($after.base_path -ne $base -or $after.active -or $after.queue -gt 0 -or $after.jobs_started -ne $before.jobs_started) { throw 'Legacy service became active; nothing stopped.' }
Copy-Item -LiteralPath $recordPath -Destination (Join-Path $PSScriptRoot ('legacy-pid-backup-'+[Guid]::NewGuid().ToString('N')+'.json'))
$frontier=@($ownedPid);$childrenToStop=@()
for($depth=0;$depth -lt 5 -and $frontier.Count -gt 0;$depth++) {
 $next=@()
 foreach($parentPid in $frontier) {
  foreach($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$parentPid")) {
   if($child.Name -like 'python*.exe' -and ($child.CommandLine.Contains($expectedScript) -or $child.CommandLine.Contains('multiprocessing.spawn') -or $child.CommandLine.Contains('multiprocessing.resource_tracker'))) { $childrenToStop += [int]$child.ProcessId;$next += [int]$child.ProcessId }
  }
 }
 $frontier=$next
}
[array]::Reverse($childrenToStop)
foreach($childPid in $childrenToStop) { Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue }
Stop-Process -Id $ownedPid -Force
Remove-Item -LiteralPath $recordPath
