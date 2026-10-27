[CmdletBinding(SupportsShouldProcess=$true)]
param([string]$ExistingDirectory='', [string]$PackageDirectory='', [string]$BackupDirectory='', [string]$RestoreBackup='')
$ErrorActionPreference='Stop'
if (!$PackageDirectory) { $PackageDirectory=$PSScriptRoot }
function FullPath([string]$Path) {
    if (!$Path -or $Path.StartsWith('\\') -or ![IO.Path]::IsPathRooted($Path)) { throw '请使用本机绝对目录。' }
    $resolved=[IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($resolved -match '^[A-Za-z]:$') { throw '不能选择磁盘根目录。' }
    $cursor=$resolved
    while ($cursor) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "不处理链接路径：$cursor" }
        $parent=Split-Path $cursor -Parent; if ($parent -eq $cursor) { break }; $cursor=$parent
    }
    return $resolved
}
function Within([string]$Child,[string]$Parent) { return $Child.Equals($Parent,[StringComparison]::OrdinalIgnoreCase) -or $Child.StartsWith($Parent+'\',[StringComparison]::OrdinalIgnoreCase) }
function Files([string]$Root) {
    $todo=New-Object 'System.Collections.Generic.Queue[string]'; $todo.Enqueue($Root)
    while ($todo.Count) {
        foreach ($item in Get-ChildItem -LiteralPath $todo.Dequeue() -Force) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "目录内有链接：$($item.FullName)" }
            if ($item.PSIsContainer) { $todo.Enqueue($item.FullName) } else { $item }
        }
    }
}
function Hash([string]$Path) {
    $stream=[IO.File]::OpenRead($Path); $sha=[Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
}
function Relative([string]$Name) {
    if (!$Name -or $Name -match '(^/|\\|:|(^|/)\.\.?(/|$))' -or $Name.EndsWith('/') -or $Name -match '[. ](/|$)') { throw '文件清单路径不安全。' }
    return $Name
}
function CopyFile([string]$From,[string]$To) {
    New-Item -ItemType Directory -Path (Split-Path $To -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $From -Destination $To -Force
}
if ($RestoreBackup) {
    $backup=FullPath $RestoreBackup; $null=@(Files $backup)
    $record=Get-Content -LiteralPath (Join-Path $backup 'update-record.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($record.schema -ne 1) { throw '备份记录格式不支持。' }
    $target=FullPath $record.target; $null=@(Files $target)
    if ((Within $backup $target) -or (Within $target $backup)) { throw '备份和原目录不能重叠。' }
    $seen=@{}
    foreach ($item in $record.files) {
        $name=Relative $item.path
        if ($seen.ContainsKey($name)) { throw '备份中有重复路径。' }; $seen[$name]=$true
        if ((Hash (Join-Path $target $name)) -ne $item.after) { throw "文件已被后续修改，未回退：$name" }
        if ($item.before -and (Hash (Join-Path $backup ('files/'+$name))) -ne $item.before) { throw "备份文件损坏：$name" }
    }
    if (!$PSCmdlet.ShouldProcess($target,'恢复更新前文件')) { return }
    foreach ($item in $record.files) {
        $destination=Join-Path $target $item.path
        if ($item.before) { CopyFile (Join-Path $backup ('files/'+$item.path)) $destination }
        else { Remove-Item -LiteralPath $destination }
    }
    foreach ($item in $record.files) {
        if ($item.before -and (Hash (Join-Path $target $item.path)) -ne $item.before) { throw '回退校验失败，请保留备份。' }
    }
    Write-Host '回退完成。重新加载原扩展，再刷新视频页。'; return
}
$package=FullPath $PackageDirectory
$descriptor=Get-Content -LiteralPath (Join-Path $package 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($descriptor.schema -ne 1 -or $descriptor.product -ne 'subtitle-assistant' -or $descriptor.version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { throw '不是受支持的字幕助手正式包。' }
$source=FullPath (Join-Path $package 'extension'); $sourceFiles=@(Files $source)
if (!$ExistingDirectory) { $ExistingDirectory=Read-Host '粘贴浏览器扩展管理页显示的原加载目录（不要填新包）' }
$target=FullPath $ExistingDirectory; $targetFiles=@(Files $target)
if ((Within $target $package) -or (Within $package $target)) { throw '原加载目录与新包不能相同或嵌套。' }
$old=Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$new=Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($old.name -notin @('字幕助手','语言学习助手','BiliScript 日语学习') -or $new.name -ne '字幕助手' -or $new.version -ne $descriptor.version) { throw '扩展身份或版本不匹配。' }
if ([version]$old.version -lt [version]'2.6.3.1' -or [version]$old.version -gt [version]$new.version) { throw '原版本不在支持的更新范围内，未修改。' }
if ($old.key -ne $new.key) { throw '扩展身份 key 不同，未更新。' }
$properties=@($descriptor.files.PSObject.Properties)
if ($properties.Count -ne $sourceFiles.Count -or !$descriptor.files.'manifest.json') { throw '发布文件清单不完整。' }
$entries=@(); $seen=@{}
foreach ($property in $properties) {
    $name=Relative $property.Name
    if ($seen.ContainsKey($name) -or $property.Value -notmatch '^[0-9a-f]{64}$') { throw '文件清单无效。' }; $seen[$name]=$true
    $from=Join-Path $source $name; $to=Join-Path $target $name
    if ((Hash $from) -ne $property.Value) { throw "新包校验失败：$name" }
    $before=if (Test-Path -LiteralPath $to) { Hash $to } else { $null }
    $entries+= [pscustomobject]@{path=$name;before=$before;after=$property.Value}
}
if (!@($entries | Where-Object {$_.before -ne $_.after}).Count) { Write-Host '原目录已是相同版本和文件，无需更新。'; return }
if (!$BackupDirectory) { $BackupDirectory=Join-Path (Split-Path $target -Parent) '.subtitle-assistant-backups' }
$backups=FullPath $BackupDirectory
if ((Within $backups $target) -or (Within $target $backups) -or (Within $backups $package) -or (Within $package $backups)) { throw '备份目录必须独立于新包和原目录。' }
$backup=Join-Path $backups ((Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
Write-Host "原加载目录：$target"; Write-Host "更新：$($old.version) -> $($new.version)"; Write-Host "备份：$backup"
if (!$PSCmdlet.ShouldProcess($target,'完整备份后更新扩展文件')) { return }
$beforeAll=@{}
foreach ($file in $targetFiles) {
    $name=$file.FullName.Substring($target.Length+1).Replace('\','/'); $beforeAll[$name]=Hash $file.FullName
    $dest=Join-Path $backup ('files/'+$name); CopyFile $file.FullName $dest
    if ((Hash $dest) -ne $beforeAll[$name]) { throw '备份校验失败，原目录未更新。' }
}
@{schema=1;target=$target;oldVersion=$old.version;newVersion=$new.version;files=$entries;allOriginalFiles=$beforeAll;createdAt=(Get-Date).ToString('o')} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $backup 'update-record.json') -Encoding UTF8
$written=@()
try {
    foreach ($item in $entries) {
        $written+=$item; CopyFile (Join-Path $source $item.path) (Join-Path $target $item.path)
        if ((Hash (Join-Path $target $item.path)) -ne $item.after) { throw "写入校验失败：$($item.path)" }
    }
    foreach ($name in $beforeAll.Keys) {
        if (!$seen.ContainsKey($name) -and (Hash (Join-Path $target $name)) -ne $beforeAll[$name]) { throw '非发布文件发生变化。' }
    }
} catch {
    foreach ($item in $written) {
        $to=Join-Path $target $item.path
        if ($item.before) { CopyFile (Join-Path $backup ('files/'+$item.path)) $to }
        elseif (Test-Path -LiteralPath $to) { Remove-Item -LiteralPath $to }
    }
    throw
}
Write-Host '更新完成。重新加载原扩展，再刷新视频页和设置页。浏览器数据、本地模型和服务未修改。'
Write-Host "回退备份：$backup"
