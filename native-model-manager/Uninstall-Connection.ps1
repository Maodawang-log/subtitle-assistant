[CmdletBinding(SupportsShouldProcess=$true)]
param([string]$InstallDirectory='')
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($InstallDirectory)) { $InstallDirectory=$PSScriptRoot }
$destination=(Resolve-Path -LiteralPath $InstallDirectory).Path
$manifestPath=Join-Path $destination 'native-host.json'
$backup=Get-Content -LiteralPath (Join-Path $destination 'registration-backup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($record in $backup) {
 if($record.path -notin @('HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.biliscript.local_models','HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.biliscript.local_models')) { throw '注册备份包含不支持的目标。' }
 if(!(Test-Path -LiteralPath $record.path)) { continue }
 if((Get-Item -LiteralPath $record.path).GetValue('') -ne $manifestPath) { Write-Host '连接已由其他安装更新，跳过。';continue }
 if($PSCmdlet.ShouldProcess($record.path,'恢复安装前的当前用户连接')) {
  if($record.existed) { Set-Item -LiteralPath $record.path -Value $record.value } else { Remove-Item -LiteralPath $record.path }
 }
}
Write-Host '连接已解除。模型、原启动脚本及浏览器设置均保留。'
