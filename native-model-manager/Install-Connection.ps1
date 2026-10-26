[CmdletBinding(SupportsShouldProcess=$true)]
param([string[]]$ExtensionId=@(),[string]$InstallDirectory='E:\Work\日语视频学习插件\local-asr\model-manager-1.0.0',[string]$LegacyBase='E:\Work\日语视频学习插件\local-asr')
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
$destination=Assert-LocalPath $InstallDirectory
$base=Assert-LocalPath $LegacyBase
$python=Join-Path $base '.venv\Scripts\python.exe'
if(!(Test-Path -LiteralPath $python)) { throw '没有找到已有本地识别环境；请检查 E 盘项目位置。' }
$manifestPath=Join-Path $destination 'native-host.json'
$hostName='com.biliscript.local_models'
$registryPaths=@("HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName","HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName")
$origins=@($ExtensionId | ForEach-Object { "chrome-extension://$_/" })
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
foreach($property in $hashes.PSObject.Properties) { $file=Join-Path $PSScriptRoot $property.Name;if((Get-PackageHash $file) -ne $property.Value) { throw ('安装包文件校验失败：'+$property.Name) } }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
if(Get-ChildItem -LiteralPath $destination -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw '安装目录内存在链接，未更新。' }
$backupPath=Join-Path $destination 'registration-backup.json'
if(!(Test-Path -LiteralPath $backupPath)) {
 $backup=@()
 foreach($path in $registryPaths) { $exists=Test-Path -LiteralPath $path;$value=if($exists) { (Get-Item -LiteralPath $path).GetValue('') } else { $null };$backup+=@{path=$path;existed=$exists;value=$value} }
 $backup | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $backupPath -Encoding UTF8
}
foreach($property in $hashes.PSObject.Properties) { $source=Join-Path $PSScriptRoot $property.Name;$target=Join-Path $destination $property.Name;New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null;Copy-Item -LiteralPath $source -Destination $target -Force }
@{legacyBase=$base} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'host-config.json') -Encoding UTF8
[IO.File]::WriteAllText((Join-Path $destination 'python-path.txt'),$python,(New-Object Text.UTF8Encoding($false)))
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
foreach($path in $registryPaths) { New-Item -Path $path -Force | Out-Null;Set-Item -LiteralPath $path -Value $manifestPath }
Write-Host '连接完成。回到插件设置页点击“刷新状态”。若原服务已运行，可继续使用，或按页面说明首次接管。'
