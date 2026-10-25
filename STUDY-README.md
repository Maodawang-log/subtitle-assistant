# BiliScript 日语学习 2.6.3.1

这是基于 Edmund724/BiliScript 2.6.3 的本地衍生版。上游基线提交：`e40ebd1152c13df8df293ee5d7bd42d673ec241e`（MIT）。独立学习入口只复用被动的 B 站元数据、字幕轨和音轨地址模块；原上游入口、旧 Digest 方案和 Fushi 均保留。

## 使用

1. 双击 `E:\Work\日语视频学习插件\local-asr\Start-Local-ASR.cmd`。有日文 CC 或只导入字幕时可不启动。
2. Chrome/Edge 的扩展管理页开启开发者模式，加载已解压的 `E:\Work\日语视频学习插件\outputs\biliscript-japanese-study-2.6.3.1` 目录。
3. 打开 B 站视频，点“开始日语学习”。每个视频默认关闭；切换视频/分P会停止，需重新开启。
4. 设置页可选择 small/medium，填写 OpenAI 兼容 Base URL、模型和 Key。地址及模型可改；未填 Key 不影响本地识别、字幕导入、句控和录音。界面默认地址为 DeepSeek；Key 由用户自行填写，本次没有调用付费接口。
5. “跟读”打开录音页。点录音时才请求麦克风权限，录制最长90秒，可播放、保存并返回原句对照，没有发音评分。

日文 CC 优先，已有中文轨用于对照；没有日文轨才读取实际音频，固定日语 `ja`，30秒一窗、只排当前和下一窗、最多到当前位置后约60秒。解码和识别在本机服务完成。服务器只通过 Range 取窗口所需字节，有16MiB上限，拒绝不支持 Range 的源，不整轨回退。起播和跳转可能暂停等字幕；真正停止/切视频会取消当前任务及队列。

暂停、上/下句、重播、循环和字幕偏移在面板内；视频播放器内显示日中两行，支持播放器全屏。点词显示读音、原形、词性/活用；中文释义来自40词基础表、用户导入JSON词典或按需AI，IPADIC不是完整日中词典。AI可讲本句及前后小段；自动翻译仅当前/下一句，设置可关闭。请求中的字幕按数据处理。

可导入UTF-8 SRT/VTT，保存并绑定当前BV/分P；可导出字幕。文本ASR缓存最多64窗，AI缓存最多400条；不缓存音轨签名URL或音频。设置和文本缓存保存在浏览器自身的配置目录，服务、依赖、模型、源码和安装包放在E盘。

## 开发与复核

依赖版本按 `package.json` 的 pnpm 12；本机可用 `E:\Work\日语视频学习插件\development\toolchain\node_modules\@pnpm\exe.win32-x64\pnpm.exe` 安装锁定依赖。

```text
pnpm install --frozen-lockfile
node scripts/build-study.cjs
node node_modules/vitest/vitest.mjs run
node_modules\.bin\tsc.cmd --noEmit
```

`dist-study/` 为独立构建产物，不能与原 `dist/` 混装。构建校验原自动content/background/offscreen入口没有进入bundle。新入口和消息协议在 `extension/study/`；用户明确开启决策见ADR-0020。

真实隔离 Edge 的可重复界面检查：`node scripts/browser-harness/study-smoke.mjs --fixture-only`。此检查明确使用合成字幕夹具与fake麦克风，证明DOM、控制及真实MediaRecorder/Blob回放，不证明B站真实音轨成功。真实公开页验证和本地真人日语ASR验证单独记录。

本地服务文档和测试见 `E:\Work\日语视频学习插件\local-asr\README.md`。small与medium已在RTX4060 Laptop上以JSUT真人小样本比较；small默认更快，两者有相同错词，不保证新闻、人名及噪音场景。ASR时间戳也不能当作发音或音高评分。

## 保留与回退

停用此扩展即可恢复浏览器原播放。停止本地服务用 `Stop-Local-ASR.cmd`。不要同时启用旧Digest学习扩展和本版，以免叠加界面。原版目录和旧快照均未覆盖。上游基线tag `biliscript-upstream-2.6.3`，本版代码另行提交/tag，最终安装包的SHA见交付清单。

BiliScript遵守根目录MIT许可；kuromoji/IPADIC的许可与来源说明在 `extension/study/licenses/`，构建保留这些文件。模型及真人测试录音许可在本地ASR目录输出文档内。

## 本机交付验证（2026-10-26）

最终全仓回归378个测试文件通过、5088项通过、17项跳过；最后CDN主机补丁另跑相关23项通过，TypeScript检查与独立构建通过。隔离Edge夹具12项通过，含播放器字幕/全屏/句控，以及仅用fake麦克风WAV的真实MediaRecorder/Blob回放。没有使用实际麦克风，没有发送Key或付费请求。

真实视频BV1Qtnt6JEy8在隔离会话显示视频不见了；补试BV1wYAmeqEuV可播（128秒，界面标30秒试看），语言前缀匹配已修。但页面MAIN请求/x/web-interface/view返回HTTP412，元数据阶段停止，实际B站CC/音轨转写未通过验收。只读同页videoData身份匹配且字幕列表为空；playinfo有音轨但不含可独立核对的BV/CID，不把它当作已验证音轨兜底。页面解析思路对照[yt-dlp源码](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py)，本版未增加未经身份验证的全局对象回退。

已观察的B站音轨主机还包括upos-hz-mirrorakam.akamaized.net；代理和本地服务只额外精确放行此主机，仍不放行任意Akamai域名，并保留公网DNS/跳转逐次校验。

一次隔离Edge临时目录清理被自动审批拒绝（理由仅为“blocked by policy”），已停止重试；残留在 .scratch/browser-temp/japanese-study-lSfo3h，已无对应Edge进程。后续只读核查产生的另一个独立profile正常清理。该残留不纳入安装包或源码快照。
