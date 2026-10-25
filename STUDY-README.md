# BiliScript 日语学习 2.6.3.2

基于Edmund724/BiliScript 2.6.3（MIT），基线 `e40ebd1152c13df8df293ee5d7bd42d673ec241e`。本地独立学习入口按视频手动开启；旧2.6.3.1、Digest、Fushi及原上游保留。

## 安装和使用

1. 启动 `E:\Work\日语视频学习插件\local-asr\Start-Local-ASR.cmd`。
2. Edge/Chrome扩展管理页开启开发者模式，加载解压目录 `E:\Work\日语视频学习插件\outputs\biliscript-japanese-study-2.6.3.2`，停用正在运行的旧学习版，再刷新视频页。
3. 先正常播放视频几秒，让播放器取得实际音轨，然后点“开始日语学习”。每个视频默认关闭；换视频/分P后需重新开启。无法关联时请播放几秒后点“重新取字幕”。
4. DeepSeek/OpenAI兼容地址、模型、Key在齿轮设置页填写。Key自行填写；没有Key仍可本地识别、导入字幕、看读音/原形、句控、录音。此次没有调用付费文字接口。

原文/中文overlay、点词、上/下句、暂停、重播、循环、偏移、UTF-8 SRT/VTT导入/导出、跟读录音均保留。中文释义来自40词基础表、导入JSON或按需AI，IPADIC不等于完整日中词典。录音最长90秒，用户点击后才请求麦克风；可回放/保存/原声对照，无发音评分。

## 2.6.3.2增量

元数据接口HTTP412时，不能仅因playinfo缺BV/CID而停止，也不能随意采用它。新入口只在当前videoData BV/P/CID、活动video生命周期、音轨路径双CID，以及实际当前代次206资源完整URL全都匹配后复用页面现有音轨。无日文轨时以ja交给本地ASR，跳过本例触发412的元数据/播放接口。没有足够证据则拒绝，未知字幕列表或已有日语轨继续CC优先处理。

每窗30秒、当前/下一窗、串行处理，最多提前约60秒。页面试看30秒时只能处理0–30秒；未确认登录状态时也只前30秒，不根据seekable/dash全时长扩大。明确试看上限未知就拒绝。已见试看限制即使toast关掉也保持。同BV换P、A→B→A、video节点或媒体源更换都会重新建立关联。用户跳转先取消旧任务，fresh来源和fresh上限通过后再启动。

MAIN被动脚本在学习关闭时只记录路由/播放器代次，不发字幕、音频或AI请求。每窗发送前和返回后重验，旧结果不会交给界面/缓存。音轨签名URL仅存会话内存；ASR文本缓存64窗，AI缓存400条。服务仍用Range读取，16MiB上限，无整轨兜底。

## 实际验收范围

2026-10-26隔离Edge中，公开新闻 `BV1wYAmeqEuV` 的页面字幕列表为空。该页正常可播、128秒、界面显示30秒试看。插件只发1个 `start=0,duration=30,language=ja,model=small` 窗口，实际音轨返回5条absolute日语字幕（1.88–29.40秒），侧栏、假名和播放器overlay实际显示；无第二窗、无Key。专名有错，画面中文来自视频自带烧录，不能当插件AI翻译。

同BV合成切P2后因CID不符拒绝，返回P1后因旧206记录早于新epoch拒绝；这组9项真机检查不发新音频，不是假装真实另一个分P存在。各类伪造URL、同长旧playinfo、旧请求迟到、来源/视频替换、seek/关闭/换P竞态由定向测试覆盖。

small与medium已在本机RTX4060 Laptop比较并安装，默认small。先前16.69秒JSUT真人小样本，small/medium的字符差错率同为7.23%，small热请求更快；这不保证新闻、人名和噪声准确率。新闻本轮small结果有错误，未宣称完整128秒、所有站点/视频或云翻译均已验证。

## 开发与恢复

```text
pnpm install --frozen-lockfile
node scripts/build-study.cjs
node node_modules/vitest/vitest.mjs run tests/study-native-source.test.ts tests/study-ui.test.ts tests/study-audio.test.ts
node_modules\.bin\tsc.cmd --noEmit
```

使用pnpm12；本机直接exe在E盘development/toolchain。构建仅输出dist-study，检查原自动content/background/offscreen入口未进入bundle。真实浏览器场景用仓库 `scripts/browser-harness/study-smoke.mjs`，合成路由失效用 `--native-stale-only`。设计见ADR-0020/0021。

2.6.3.1的tag、安装目录、zip、bundle和报告未改；2.6.3.2单独提交/tag与打包。本地服务文档、模型清单和依赖锁在 `E:\Work\日语视频学习插件\local-asr`。停用本扩展、停止服务即可撤回运行；不改系统PATH。

此前自动审批拦截的唯一旧临时profile目录维持原样，未重新尝试删除。后续新增隔离profile均由harness正常收尾。第三方许可在study/licenses、根LICENSE及本地服务outputs。

## 2.6.3.2 checks

114 directed checks passed across 10 files; TypeScript and build passed. Real-news browser checks: 13/13. Synthetic same-BV P1/P2/P1 stale checks: 9/9. The final native-cap waiting correction was covered by the directed UI test; unrelated full-repository tests were not repeated.
