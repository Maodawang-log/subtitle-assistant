[CmdletBinding(SupportsShouldProcess=$true)]
param([string[]]$ExtensionId=@(),[string]$InstallDirectory='',[string]$LegacyBase='E:\Work\日语视频学习插件\local-asr')
$ErrorActionPreference='Stop'
function Get-PackageHash([string]$path) {
 $stream=[IO.File]::OpenRead($path);$algorithm=[Security.Cryptography.SHA256]::Create()
 try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose();$algorithm.Dispose() }
}
if(!$ExtensionId.Count) { $ExtensionId=@((Read-Host '粘贴新版扩展设置页显示的扩展 ID')) }
foreach($id in $ExtensionId) { if($id -notmatch '^[a-p]{32}$') { throw '扩展 ID 必须是设置页显示的 32 位字母，不是浏览器地址。' } }
function Assert-LocalPath([string]$value) {
 if(!$value -or $value.StartsWith('\\') -or ![IO.Path]::IsPathRooted($value) -or $value.Split('\') -contains '..') { throw '请使用本机绝对路径。' }
 $resolved=[IO.Path]::GetFullPath($value).TrimEnd('\')
 if($resolved -match '^[A-Za-z]:$') { throw '请使用专用文件夹，不要选择磁盘根目录。' }
 $current=$resolved
 while($current) { try { $attributes=[IO.File]::GetAttributes($current);if($attributes -band [IO.FileAttributes]::ReparsePoint) { throw '不安装到链接目录。' } } catch [IO.FileNotFoundException] {} catch [IO.DirectoryNotFoundException] {};$parent=Split-Path $current -Parent;if($parent -eq $current) { break };$current=$parent }
 return $resolved
}
$hostName='com.biliscript.local_models'
$registryPaths=@("HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName","HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName")
$registered=@($registryPaths | Where-Object {Test-Path -LiteralPath $_} | ForEach-Object {(Get-Item -LiteralPath $_).GetValue('')} | Select-Object -Unique)
if($registered.Count -gt 1) { throw 'Edge 与 Chrome 当前连接到不同目录，请先分别确认原连接，未修改任何配套。' }
if($registered.Count -eq 1) {
 $registeredPath=Assert-LocalPath $registered[0]
 $registeredManifest=Get-Content -LiteralPath $registeredPath -Raw -Encoding UTF8 | ConvertFrom-Json
 if($registeredManifest.name -ne $hostName -or $registeredManifest.path -ne (Join-Path (Split-Path $registeredPath -Parent) 'native-host.exe')) { throw '已有注册不属于可识别的配套，未覆盖。' }
 $registeredHome=Split-Path $registeredPath -Parent
 if($InstallDirectory -and (Assert-LocalPath $InstallDirectory) -ne $registeredHome) { throw '已有连接请在原目录升级，以保留服务与模型归属；不要更换配套目录。' }
 $InstallDirectory=$registeredHome
 if(!$PSBoundParameters.ContainsKey('LegacyBase')) { $LegacyBase=(Get-Content -LiteralPath (Join-Path $registeredHome 'host-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json).legacyBase }
}
if(!$InstallDirectory) {$InstallDirectory='E:\Work\日语视频学习插件\local-asr\model-manager-1.1.0'}
$destination=Assert-LocalPath $InstallDirectory
$base=Assert-LocalPath $LegacyBase
$python=Join-Path $base '.venv\Scripts\python.exe'
if(!(Test-Path -LiteralPath $python)) { throw '没有找到已有本地识别环境；请检查 E 盘项目位置。' }
$manifestPath=Join-Path $destination 'native-host.json'
$origins=@($ExtensionId | ForEach-Object { "chrome-extension://$_/" })
if($registeredManifest) {$origins=@($origins+@($registeredManifest.allowed_origins | Where-Object {$_ -match '^chrome-extension://[a-p]{32}/$'}) | Select-Object -Unique)}
$manifest=@{name=$hostName;description='BiliScript local model manager';path=(Join-Path $destination 'native-host.exe');type='stdio';allowed_origins=$origins}
Write-Host ('连接目录：'+$destination)
Write-Host ('仅允许扩展：'+($ExtensionId -join ', '))
Write-Host '只注册当前 Windows 用户的 Edge/Chrome 连接；不启动服务、不下载模型、不更改原启动脚本。'
if(!$PSCmdlet.ShouldProcess($destination,'复制配套文件并注册当前用户 Native Messaging 连接')) { return }
if(Test-Path -LiteralPath $destination) {
 $existingManifest=Join-Path $destination 'native-host.json'
 if(@(Get-ChildItem -LiteralPath $destination -Force).Count -gt 0) {
  if(!(Test-Path -LiteralPath $existingManifest)) { throw '目标文件夹已有其他内容，请选择新的专用文件夹。' }
  $existing=Get-Content -LiteralPath $existingManifest -Raw -Encoding UTF8 | ConvertFrom-Json
  if($existing.name -ne $hostName -or $existing.path -ne (Join-Path $destination 'native-host.exe')) { throw '目标不是本管理器的安装目录。' }
 }
}
$hashes=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package-hashes.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$packageNames=@('manager.py','catalog.py','model_files.py','host.py','Launcher.cs','model-catalog.json','service-provenance.json','Install-Connection.ps1','Uninstall-Connection.ps1','stop-owned-service.ps1','takeover-legacy.ps1','README.md','service/server.py','service/window_audio.py','native-host.exe','Install-Connection.cmd','Uninstall-Connection.cmd')
if(@($hashes.PSObject.Properties).Count -ne $packageNames.Count) {throw '安装包文件清单不完整。'}
foreach($property in $hashes.PSObject.Properties) {
 if($property.Name -cnotin $packageNames -or $property.Value -notmatch '^[0-9a-f]{64}$') {throw '安装包包含未知文件或无效摘要。'}
 $file=Assert-LocalPath (Join-Path $PSScriptRoot $property.Name)
 if((Get-PackageHash $file) -ne $property.Value) { throw ('安装包文件校验失败：'+$property.Name) }
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
if(Get-ChildItem -LiteralPath $destination -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw '安装目录内存在链接，未更新。' }
$gate=$null
try { $gate=[IO.File]::Open((Join-Path $destination 'manager.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) } catch { throw '请关闭设置页，在扩展管理页重新加载扩展，暂不打开设置，再运行升级；无需停止原识别服务。' }
try {
if(Test-Path -LiteralPath (Join-Path $destination 'native-host.exe')) {
 try { $probe=[IO.File]::Open((Join-Path $destination 'native-host.exe'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$probe.Dispose() } catch { throw '配套仍被浏览器占用，请关闭设置页并重新加载扩展后重试；原服务保持运行。' }
}
$codeBackup=Join-Path $destination ('code-backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $codeBackup | Out-Null
$journal=@()
foreach($name in @($packageNames)+@('host-config.json','python-path.txt','native-host.json')) {
 $old=Join-Path $destination $name;$exists=Test-Path -LiteralPath $old;$entry=@{name=$name;existed=$exists}
 if($exists) {$entry.hash=Get-PackageHash $old;$saved=Join-Path $codeBackup $name;New-Item -ItemType Directory -Path (Split-Path $saved -Parent) -Force | Out-Null;Copy-Item -LiteralPath $old -Destination $saved;if((Get-PackageHash $saved) -ne $entry.hash){throw '备份校验失败，原配套尚未更新。'}}
 $journal+=$entry
}
$journal | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $codeBackup 'backup-hashes.json') -Encoding UTF8
Write-Host ('旧配套代码备份：'+$codeBackup)
$beforeRegistration=@()
foreach($path in $registryPaths) {$exists=Test-Path -LiteralPath $path;$value=if($exists){(Get-Item -LiteralPath $path).GetValue('')}else{$null};$beforeRegistration+=@{path=$path;existed=$exists;value=$value}}
$backupPath=Join-Path $destination 'registration-backup.json'
if(!(Test-Path -LiteralPath $backupPath)) {
 $beforeRegistration | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $backupPath -Encoding UTF8
}
$registrationTouched=$false
try {
foreach($property in $hashes.PSObject.Properties) { $source=Join-Path $PSScriptRoot $property.Name;$target=Join-Path $destination $property.Name;New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null;Copy-Item -LiteralPath $source -Destination $target -Force;if((Get-PackageHash $target) -ne $property.Value){throw ('新文件校验失败：'+$property.Name)} }
$configPath=Join-Path $destination 'host-config.json'
$config=if(Test-Path -LiteralPath $configPath){Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json}else{New-Object PSObject}
$config | Add-Member -NotePropertyName legacyBase -NotePropertyValue $base -Force
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding UTF8
[IO.File]::WriteAllText((Join-Path $destination 'python-path.txt'),$python,(New-Object Text.UTF8Encoding($false)))
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$registrationTouched=$true
foreach($path in $registryPaths) { New-Item -Path $path -Force | Out-Null;Set-Item -LiteralPath $path -Value $manifestPath }
} catch {
 $failure=$_;$restoreErrors=@()
 foreach($entry in $journal){try{$target=Join-Path $destination $entry.name;if($entry.existed){Copy-Item -LiteralPath (Join-Path $codeBackup $entry.name) -Destination $target -Force;if((Get-PackageHash $target) -ne $entry.hash){throw '恢复摘要不匹配'}}elseif(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Force}}catch{$restoreErrors+=$entry.name}}
 if($registrationTouched){foreach($entry in $beforeRegistration){try{if($entry.existed){New-Item -Path $entry.path -Force | Out-Null;Set-Item -LiteralPath $entry.path -Value $entry.value}elseif(Test-Path -LiteralPath $entry.path){Remove-Item -LiteralPath $entry.path -Force}}catch{$restoreErrors+=$entry.path}}}
 if($restoreErrors.Count){throw ('更新失败，部分文件需要从备份恢复：'+$codeBackup+'；'+($restoreErrors -join ', '))}
 throw ('更新失败，已恢复原配套和注册：'+$failure.Exception.Message)
}
Write-Host '1.1.0 连接完成。原管理状态、服务记录与模型保持不变。回到插件设置页点击“刷新状态”。'
} finally {if($gate) {$gate.Dispose()}}
