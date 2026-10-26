[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ExistingDirectory = "",
    [string]$PackageDirectory = "E:\Work\日语视频学习插件\outputs\biliscript-japanese-study-2.6.5.1"
)
$ErrorActionPreference = "Stop"
function Get-PackageHash([string]$path) {
    $stream=[IO.File]::OpenRead($path);$algorithm=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose();$algorithm.Dispose() }
}
$taskRoot = "E:\Work\日语视频学习插件"
if ([string]::IsNullOrWhiteSpace($ExistingDirectory)) {
    Write-Host "请在 Edge/Chrome 扩展管理页查看当前语言学习扩展（旧名 BiliScript 日语学习）的加载目录。"
    Write-Host "本脚本保留该路径，先完整备份再更新文件；不读取浏览器配置或 API Key。"
    $ExistingDirectory = Read-Host "粘贴扩展管理页显示的原加载目录"
}
$target = (Resolve-Path -LiteralPath $ExistingDirectory).Path.TrimEnd('\')
$source = (Resolve-Path -LiteralPath $PackageDirectory).Path.TrimEnd('\')
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot "outputs")).TrimEnd('\') + '\'
if (!$target.StartsWith($allowedRoot,[StringComparison]::OrdinalIgnoreCase)) { throw "原目录必须在 $allowedRoot 内。本脚本不修改其他位置。" }
if ($target -eq $source) { throw "原加载目录与新版本目录相同，无需原地升级。" }
if (!(Split-Path -Leaf $target).StartsWith("biliscript-japanese-study-")) { throw "目标不是命名的日语学习插件目录。" }
foreach ($folder in @($target,$source)) {
    if ((Get-Item -LiteralPath $folder).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "不更新重解析/链接目录。" }
    if (Get-ChildItem -LiteralPath $folder -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw "目录内存在链接，未进行修改。" }
}
$old = Get-Content -LiteralPath (Join-Path $target "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$new = Get-Content -LiteralPath (Join-Path $source "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if ($old.name -notin @("BiliScript 日语学习","语言学习助手") -or $new.name -ne "语言学习助手" -or $new.version -ne "2.6.5.1") { throw "扩展身份或新包版本不匹配。" }
if ($old.version -eq $new.version) { Write-Host "此目录已经是 2.6.5.1。"; return }
if ($old.version -notin @("2.6.3.1","2.6.3.2","2.6.3.3","2.6.3.4","2.6.3.5","2.6.3.6","2.6.4.0","2.6.5.0")) { throw "此脚本支持从2.6.3.1至2.6.5.0升级。" }
$stamp = (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + [Guid]::NewGuid().ToString("N").Substring(0,8)
$backup = Join-Path $taskRoot ("snapshots\in-place-upgrade-" + $stamp)
Write-Host "原加载目录：$target"
Write-Host "新版本来源：$source"
Write-Host "完整备份至：$backup"
if (!$PSCmdlet.ShouldProcess($target,"完整备份后原地升级为2.6.5.1")) { return }
New-Item -ItemType Directory -Path $backup | Out-Null
$before = @()
foreach ($file in Get-ChildItem -LiteralPath $target -File -Recurse -Force) {
    $relative = $file.FullName.Substring($target.Length + 1)
    $before += [PSCustomObject]@{ Path=$relative; SHA256=(Get-PackageHash $file.FullName) }
}
foreach ($item in Get-ChildItem -LiteralPath $target -Force) { Copy-Item -LiteralPath $item.FullName -Destination $backup -Recurse -Force }
foreach ($entry in $before) {
    if ((Get-PackageHash (Join-Path $backup $entry.Path)) -ne $entry.SHA256) { throw "备份校验失败，原目录尚未更新。" }
}
$record = [PSCustomObject]@{ Original=$target; Package=$source; Backup=$backup; OldVersion=$old.version; NewVersion=$new.version; Files=$before }
$record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path (Split-Path $backup -Parent) ("upgrade-record-"+$stamp+".json")) -Encoding UTF8
# Only copy package files. Do not delete old artifacts or touch browser storage.
foreach ($item in Get-ChildItem -LiteralPath $source -Force) { Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse -Force }
foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse -Force) {
    $relative = $file.FullName.Substring($source.Length + 1)
    if ((Get-PackageHash (Join-Path $target $relative)) -ne (Get-PackageHash $file.FullName)) { throw "新文件校验失败。完整旧版备份：$backup" }
}
Write-Host ""
Write-Host "文件升级完成。请在扩展管理页点击原扩展的“重新加载”，然后刷新B站视频页。"
Write-Host "不要删除原扩展或改为加载新路径；这样浏览器中的原设置可继续沿用。"
Write-Host "回退：关闭学习，将备份目录中的全部文件复制回原加载目录，再重新加载扩展。"
Write-Host "备份：$backup"
