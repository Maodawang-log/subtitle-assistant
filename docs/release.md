# 正式发布与恢复

扩展版本唯一来源为 package.json。修改版本及 CHANGELOG 后运行 pnpm install --frozen-lockfile、pnpm typecheck、pnpm test、python scripts/audit-study-repository.py。源码修改应提交后再正式打包，release.json 的 sourceCommit 与 sourceDirty 记录来源。

在仓库根运行 python scripts/package-study-release.py。Windows 同时构建本地配套；其他系统加 --skip-native。已存在的发行目录不会被覆盖，重新验证时用 --output-root 指定独立目录。完整包不含模型、Python 环境、个人配置、字幕、音频或浏览器数据。模型配套当前为 1.2.1，独立于扩展版本。

正式包包含 extension、可选 native-model-manager、Update-Extension.ps1 / cmd、release.json、package-hashes.json、README、隐私说明、LICENSE 及 NOTICE。release.json 校验全部扩展文件；package-hashes.json 校验所有交付文件（不含它自身）；同目录的 verification.json 记录 ZIP SHA256。不是数字签名，须从可信仓库取得。

## 原地更新

关闭字幕学习，在发布包根目录运行 Update-Extension.cmd，输入浏览器扩展管理页显示的原加载目录；也可显式运行：

```powershell
powershell.exe -NoProfile -File .\Update-Extension.ps1 -ExistingDirectory "原加载目录" -WhatIf
powershell.exe -NoProfile -File .\Update-Extension.ps1 -ExistingDirectory "原加载目录"
```

支持从 2.6.3.1 起的学习版更新，不允许降级、不同扩展身份、源和目标嵌套、链接目录或损坏的发布文件。相同版本且文件一致时不写入。原加载路径必须保持不变；带 manifest key 的安装要求新旧 key 一致，否则拒绝。

完整原目录备份默认存于原加载目录旁 .subtitle-assistant-backups/日期-标识/files，旁有 update-record.json；可用 -BackupDirectory 指定其他独立本机目录。全部备份通过校验后才覆盖，保留发布清单外文件。写入失败尝试恢复已改文件，备份始终保留。

完成后重新加载原扩展，再刷新视频和设置页。不要卸载原扩展、不要加载另一条路径。脚本只处理扩展文件，不修改浏览器存储、用户词典、服务、模型、注册表或快捷方式。

## 回退

```powershell
powershell.exe -NoProfile -File .\Update-Extension.ps1 -RestoreBackup "更新时输出的备份目录" -WhatIf
powershell.exe -NoProfile -File .\Update-Extension.ps1 -RestoreBackup "更新时输出的备份目录"
```

回退先核验本次更新所有目标文件及备份摘要。发现后续修改则拒绝，避免覆盖较新内容；没有冲突时恢复原字节，并仅删除本次新增加的文件。之后重新加载扩展。浏览器学习数据本就没有修改；本工具不是浏览器账户数据备份器。

在隔离目录验证：python scripts/test-study-release.py --package "完整发布包目录"。覆盖预览、完整备份、更新、重复执行、回退预览、精确恢复、新增文件移除、后续修改保护、版本和 key 不符、损坏文件、junction 拒绝等。不会操作用户安装目录。

## 本地配套与数据

扩展 2.7.0 继续使用管理器 1.2.1。已安装配套未变化时不用重装。确需更新配套时，按其 README 等共享任务结束，先停止识别再退出管理器连接。安装脚本不会替用户停止共享服务。

工程清理必须保留实际注册的 Native Messaging 目录、Python 环境和模型、当前扩展加载目录、连接快捷方式及其目标。不要依据目录名称上的旧版本号判断它可以删除。先核实 Git 远端、发行包和最小恢复点，再删除独立旧包和隔离缓存。
