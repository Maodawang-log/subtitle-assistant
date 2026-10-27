[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ExistingDirectory = "E:\Work\日语视频学习插件\outputs\biliscript-japanese-study-2.6.5.1",
    [string]$PackageDirectory = $PSScriptRoot,
    [string]$RestoreBackup = "",
    [switch]$Restore
)
$ErrorActionPreference = "Stop"
$projectRoot = 'E:\Work\日语视频学习插件'
$allowedNames = @('options.html','options.css','options.js','options.js.map')
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function NoLink([string]$Path) {
    if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "路径为链接，未修改：$Path" }
}
if ($Restore -and !$RestoreBackup) { $RestoreBackup = Read-Host '粘贴更新时显示的备份目录' }
$restoring = ![string]::IsNullOrWhiteSpace($RestoreBackup)
if ($restoring) {
    $backupRoot = (Resolve-Path -LiteralPath $RestoreBackup).Path.TrimEnd('\')
    $snapshotsRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'snapshots')).TrimEnd('\') + '\'
    if (!$backupRoot.StartsWith($snapshotsRoot,[StringComparison]::OrdinalIgnoreCase) -or !(Split-Path -Leaf $backupRoot).StartsWith('settings-redesign-')) { throw '不是本次设置页更新的备份目录。' }
    NoLink $backupRoot
    $record = Get-Content -LiteralPath (Join-Path $backupRoot 'update-record.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $ExistingDirectory = $record.Target
    $source = $backupRoot
} else {
    $package = (Resolve-Path -LiteralPath $PackageDirectory).Path
    NoLink $package
    $descriptor = Get-Content -LiteralPath (Join-Path $package 'settings-update.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($descriptor.version -ne '2.6.5.2') { throw '更新包版本不匹配。' }
    $source = Join-Path $package 'files'
    NoLink $source
}
$target = (Resolve-Path -LiteralPath $ExistingDirectory).Path.TrimEnd('\')
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'outputs')).TrimEnd('\') + '\'
if (!$target.StartsWith($allowedRoot,[StringComparison]::OrdinalIgnoreCase) -or !(Split-Path -Leaf $target).StartsWith('biliscript-japanese-study-')) { throw '请指定 outputs 中现有的字幕助手加载目录。' }
NoLink $target
NoLink (Join-Path $target 'study')
$manifestPath = Join-Path $target 'manifest.json'
NoLink $manifestPath
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -ne '字幕助手' -or $manifest.version -ne '2.6.5.2') { throw '此热更新仅适用于字幕助手 2.6.5.2。' }
$entries = @()
foreach ($name in $allowedNames) {
    $dest = Join-Path $target ('study\' + $name)
    $src = Join-Path $source $name
    NoLink $dest
    NoLink $src
    $before = Hash $dest
    $after = Hash $src
    if ($restoring) {
        $entry = @($record.Files | Where-Object { $_.Name -eq $name })
        if ($entry.Count -ne 1 -or $after -ne $entry[0].Before -or $before -ne $entry[0].After) { throw "文件已被后续更新或备份损坏，未回退：$name" }
    } elseif ($after -ne $descriptor.files.$name) { throw "更新包校验失败：$name" }
    $entries += [PSCustomObject]@{Name=$name;Before=$before;After=$after;Source=$src;Destination=$dest}
}
if (!@($entries | Where-Object { $_.Before -ne $_.After }).Count) { Write-Host '此目录已经使用相同的设置页文件。'; return }
$action = if ($restoring) { '恢复旧设置页' } else { '备份后更新设置页（版本号不变）' }
Write-Host "加载目录：$target"
if (!$PSCmdlet.ShouldProcess($target,$action)) { return }
$backup = Join-Path $projectRoot ('snapshots\settings-redesign-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $backup | Out-Null
$protected = @{}
foreach ($item in Get-ChildItem -LiteralPath $target -File -Recurse) {
    if ($entries.Destination -notcontains $item.FullName) { $protected[$item.FullName] = Hash $item.FullName }
}
foreach ($entry in $entries) {
    $copy = Join-Path $backup $entry.Name
    Copy-Item -LiteralPath $entry.Destination -Destination $copy
    if ((Hash $copy) -ne $entry.Before) { throw '备份校验失败，原目录未更新。' }
}
$written = @()
[PSCustomObject]@{Target=$target;Version=$manifest.version;Operation=$action;Files=$entries;CreatedAt=(Get-Date).ToString('o')} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $backup 'update-record.json') -Encoding UTF8
try {
    foreach ($entry in $entries) {
        $written += $entry
        Copy-Item -LiteralPath $entry.Source -Destination $entry.Destination -Force
        if ((Hash $entry.Destination) -ne $entry.After) { throw "写入校验失败：$($entry.Name)" }
    }
    foreach ($item in $protected.Keys) { if ((Hash $item) -ne $protected[$item]) { throw "设置页以外的文件发生变化：$item" } }
} catch {
    foreach ($entry in $written) { Copy-Item -LiteralPath (Join-Path $backup $entry.Name) -Destination $entry.Destination -Force }
    throw
}
Write-Host '完成。关闭并重新打开设置页，或直接刷新设置页即可。'
Write-Host '播放器、模型、词典、浏览器设置和识别服务均未修改。'
Write-Host "备份：$backup"
