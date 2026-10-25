# ADR-0021：从当前播放器已请求的音轨建立有界识别来源
> 状态：部分被 ADR-0022 取代（播放范围与恢复策略）；音轨身份关联约束继续有效。

真实新闻BV1wYAmeqEuV可以播放，但元数据API返回HTTP412。继续调用同一接口没有产生音频。当前页面已有videoData、playinfo及实际206音轨资源，因此衍生入口允许只读关联后复用播放器已取得的音轨，不伪造页面身份、不绕过登录或付费限制。

document_start的MAIN脚本只记录document、BV/分P、路由代次及活动video生命周期；不取字幕、不取音频。只有用户开启学习才读取候选和资源记录。必须同时满足：URL的BV/P与videoData一致；选中P的CID等于当前videoData.cid；唯一可见B站播放器video连接且metadata有效，blob属于本站；video、页元数据与dash时长一致；候选URL为精确白名单HTTPS，固定路径两个完整CID均匹配；完整URL与当前route/video代次之后开始的PerformanceResourceTiming精确相同，且实际responseStatus=206。只返回已验证主源，backup为空。不使用pathname-only签名回退。

同BV换P、A→B→A、video替换、loadstart/emptied、BFcache恢复会失效旧关联。每个真实窗口发送之前及结果交给缓存/界面之前重新验证；UI还检查DOM绑定标记、当前BV/P和媒体源。用户seek先取消，再用fresh来源和fresh时长重启；无法证明时拒绝。签名URL只在会话内存中存在。

识别上限取页面已声明试看范围的最小值，已见限制在当前路由内保持。没有确认登录状态时最多识别前30秒；不把128秒seekable或dash时长当作完整观看权限。明确受限但无法确定范围时不降级普通ASR。字幕列表未知或有日语轨时仍走原CC优先路径。

实测：上述新闻0–30秒实际音轨经small/ja返回5条绝对时间字幕，范围1.88–29.40秒，播放器overlay与侧栏显示；没有第二窗、无用户Key。隔离Edge合成P1→P2→P1的9项检查证明CID不符和旧performance记录会被拒绝。识别有专名错误，不代表文字准确率或云端翻译质量已验证。原2.6.3.1快照保留。
