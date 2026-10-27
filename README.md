# 字幕助手

在 B 站视频页按句学习日语和英语的 Edge / Chrome 扩展。手动开启后，优先使用所选原语言的 CC 字幕；没有可用字幕时，使用本机 Whisper 识别当前播放附近的音频。也可导入 SRT / VTT。

本分支为 **2.7.2 本地体验版**，未上传发布；已发布正式版仍为 **2.7.0**。Windows 本地识别配套 **1.2.1**。本项目由 **Maodawang-log 二次开发和维护**，不是上游 BiliScript 的官方发行版。

## 功能

| 功能 | 使用方式 |
| --- | --- |
| 原文与中文 | 日语 / 英语原文，逐句跳转、重播、循环、时间偏移，按需开启中文翻译 |
| 查词 | 日语分词、读音和原形，英语查词；下载 / 导入本地词典，将单词加入生词本 |
| 校对 | 手工修改、恢复原文；用自配文字模型校对单句或已取得字幕，保留记录及批次撤销 |
| 精听 | 隐藏助手字幕，听完一句自动暂停；原文和中文分别揭示 / 隐藏 |
| 跟读 | 点击后录音、回听、原声对照、保存录音；**没有发音、节奏或音调评分** |
| 收藏和复习 | 分开管理视频与句子收藏，句子保留来源和时间，支持生词复习 |
| 总结和问答 | 先准备全片资料，再生成简短整体概述、章节和引用；视频问答可依据当前已有字幕追问 |
| 导出 | 字幕页选择 SRT / VTT / TXT；视频页导出 Markdown 学习笔记，可附已取得字幕及已有中文，不额外调用 AI |
| 数据管理 | 未收藏资料使用有容量限制的临时缓存，收藏视频后长期保存已取得内容 |

视频页只保留一个“生成整体总结”入口：整轨 CC 直接复用；导入字幕首次确认是否包含当前分P全部台词；缺少全片资料时才补齐音频识别并复用已识别窗口。停止、失败或播放权限不足时保留已有结果。历史局部总结继续保留并标注范围；旧学习清单数据保留，界面和默认导出不再展示。

换视频 / 分 P 后需重新开启。只选择语言不会启动识别或文字 API。同语言存在至少两条字幕轨时才显示第二个选轨框。

## 安装与使用

1. 获取本仓库构建的 subtitle-assistant-2.7.2.zip，解压到固定目录；也可按下文从源码构建。
2. 打开 edge://extensions 或 chrome://extensions，开启开发者模式，“加载解压缩的扩展”选择发布包的 extension 目录（自行构建为 dist-study）。最低 Chromium 版本 120。
3. 打开 B 站视频，通过浏览器工具栏图标打开字幕助手，选择原语言并点击“开启字幕”。无对应 CC 时需已运行的本地识别服务；也可导入字幕。
4. 设置页填写文字服务的 Base URL、模型名和 API Key。支持 OpenAI 兼容聊天补全接口，例如自配 DeepSeek。没有 Key 仍可使用导入字幕、本地识别、词典、句控和录音。
5. 模型和词典分别由用户发起下载 / 导入，安装扩展不会自动下载模型。

不提供 Key，不承诺免费额度。当前通过解压包交付，不对应原项目的商店条目。

## 更新与回退

**保留原扩展和加载路径，不要先卸载或换目录重新加载。** 浏览器设置、词典和学习记录属于原扩展 ID。

发布包的 Update-Extension.ps1 先核对摘要、完整备份，再更新发布文件；不操作浏览器数据或本地服务。支持从 2.6.3.1–2.7.1 升级至本地体验版 2.7.2。在发布包根目录执行：

```powershell
powershell.exe -NoProfile -File .\Update-Extension.ps1 -ExistingDirectory "浏览器实际使用的原加载目录"
# 预览：同一命令加 -WhatIf
# 回退：使用更新完成时显示的备份目录
powershell.exe -NoProfile -File .\Update-Extension.ps1 -RestoreBackup "完整备份目录"
```

完成后在扩展管理页重新加载原扩展，再刷新视频页和设置页。备份默认在原目录旁的 .subtitle-assistant-backups。回退前核验当前文件没有被后续版本修改。详见 [发布与恢复说明](docs/release.md)。

## Windows 本地识别配套

配套通过 Native Messaging 连接浏览器，在 127.0.0.1:18766 提供本机识别。复用已有 Python 环境及 CTranslate2 / faster-whisper 模型，不把音频上传至文字 API。当前是已有 Windows 本地 ASR 环境的配套，**不是从零安装 Python、CUDA 或权重的一键安装器**。

完整正式包内 native-model-manager 提供源码、启动器与安装入口；2.7.2 本地体验包只更新扩展，配套目录仅保留说明。已有注册沿用原绝对目录、模型、设置和扩展 ID；目录名仍是 model-manager-1.0.0 不代表代码过旧，不必移动。新环境要求 LegacyBase 下已有 .venv/Scripts/python.exe 及识别依赖，参数见 [配套说明](native-model-manager/README.md)。

仅需更新配套时：等待共享任务结束 → 在设置中停止识别服务 → 退出管理器连接 → 安装配套 → 恢复连接 → 启动服务。**退出管理器连接不等于停止识别服务。** 已有 1.2.1 未变化时只更新扩展。不要在酒馆等软件使用共享服务时强行覆盖或停止它。

## 数据与隐私

- Key、接口设置、生词、收藏、校对及学习结果在浏览器扩展本地存储；词典在本地 IndexedDB，不随仓库或发行包分发。
- 临时资料默认容量 16 MiB，可在设置中调整。收藏视频只保存已取得内容，不会自动识别全片；取消视频收藏不删除独立句子收藏和生词。
- 录音保留在当前页面内存中，主动保存才生成文件；关闭页面可能丢失未保存录音。
- 翻译、讲解、AI 校对、总结、问答会将相关字幕及上下文发给你配置的文字服务。开启双语后按需请求翻译，计费和数据政策由供应商决定。
- 本地识别服务读取经校验的当前音轨地址；模型 / 词典下载访问各自来源。详见 [隐私说明](PRIVACY.md)。

## 开发与验证

需要 Node.js 22 或以上、pnpm 12；发布工具需 Python 3.11 或以上。Windows 完整配套构建使用系统 .NET Framework C# 编译器。依赖由 pnpm-lock.yaml 固定。

```text
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
python scripts/audit-study-repository.py
python scripts/package-study-release.py
python scripts/test-study-release.py
```

package.json 是扩展版本的唯一来源。构建输出 dist-study，发行包输出 release/subtitle-assistant-<版本> 和同名 ZIP，含摘要清单、升级工具、许可证。非 Windows 可加 --skip-native 构建仅扩展包。浏览器验证：node scripts/browser-harness/study-learning-audit.mjs study-release，需本机 Edge，使用隔离模拟数据；不代表真实视频、麦克风或付费接口完整验收。

extension/study 为学习功能，其他 extension 模块保留上游共享实现与回归测试；native-model-manager 为独立配套；scripts 为构建、升级和检查；tests 为离线夹具。上游入口仅通过 build:upstream 构建，不进入默认学习版。模型、运行环境、个人学习数据、profile、缓存、发行包不提交 Git。

## 能力边界

仅面向 B 站网页视频，不是任意网站或本地视频播放器插件。不绕过登录、试看或播放权限，无法确认当前音轨和可播放范围时拒绝识别。默认分窗口识别；“收集全片并总结”需主动操作且受播放范围限制。

Whisper 对人名、噪声、重叠语音或句首可能出错；开头补识别是有条件的一次重试，不保证补齐。AI 校对、释义和总结需对照原声。精听不能移除视频画面烧录字幕。问答依据字幕，不分析画面、不联网搜索事实。录音对照不等于发音评测。

## 来源与许可证

原始作者 [haixiong1997](https://github.com/haixiong1997)，原项目 [Bilibili-Obsidian-Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper)。本学习版直接基于 [Edmund724/BiliScript](https://github.com/Edmund724/BiliScript)，基线 e40ebd1152c13df8df293ee5d7bd42d673ec241e。原 README 注明 UI 参考 [zarazhangrui/youtube-digest](https://github.com/zarazhangrui/youtube-digest)。**Maodawang-log 是本分支的二次开发 / 维护者，原作者署名及历史保留。**

[MIT LICENSE](LICENSE) 保留 Copyright (c) 2026 haixiong1997 原文。第三方通知见 [NOTICE](NOTICE.md)；[上游 README 归档](docs/upstream/README.BiliScript.md) 中的功能、商店和服务信息是历史资料，不作为本版本操作说明。
