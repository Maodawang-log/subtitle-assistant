# 本地模型管理器 1.0.0

这是 2.6.4.0 扩展的 Windows 当前用户配套连接。使用现有 E 盘 Python 环境和 small/medium 模型，不另建识别环境。连接只授权安装时明确填写的扩展 ID；更换解压目录导致 ID 改变时，可重新运行安装器绑定新 ID。

1. 保持原扩展加载路径升级，在新版设置页复制扩展 ID。
2. 运行 `Install-Connection.cmd`，粘贴该 ID。它会先校验配套文件，再注册当前用户 Edge/Chrome 连接，无需管理员权限。`Install-Connection.ps1 -WhatIf -ExtensionId 实际ID` 可预览目标。
3. 回到设置页刷新状态。已有服务会直接复用，打开设置不会转写、下载模型或调用付费接口。
4. 如需由管理器启停并使用新目录，点击“首次接管现有服务”。这一步会短暂重启，先暂停本地酒馆等其他识别使用者；程序核验原服务 PID、启动时间、Python 和脚本路径，并检查两次空闲状态。无法确认或正在识别时拒绝接管。

新下载只使用 `model-catalog.json` 中固定仓库、revision、文件大小和 SHA256。目录选择只作用于以后下载，已有模型不会移动；暂存目录全部验证通过后才启用。取消、校验失败或连接关闭不会替换原安装。模型文件不经过浏览器消息通道。仅管理器拥有的模型能删除，界面会明确确认；默认/当前使用中的模型不能删除。

“设为默认”设置下一次识别使用的模型，不会偷偷提交音频。服务状态分别显示当前驻留模型与已安装模型。新目录或新下载模型需要点击“应用模型并重启”。活跃/排队任务期间不可停止；管理器服务发现其他使用者后保护 15 分钟。原服务没有消费方记录，因此首次接管要求用户确认其他使用者已暂停。

安装文件默认在 `E:\Work\日语视频学习插件\local-asr\model-manager-1.0.0`。原 `Start-Local-ASR` / `Stop-Local-ASR` 文件保持不变。管理器启动的服务由设置页停止；回到原启动方式时先安全停止管理器服务，再运行原启动脚本。

解除连接：运行安装目录中的 `Uninstall-Connection.ps1`。它只恢复本次安装前的两项当前用户注册，不删除模型、服务文件或浏览器设置；若连接已被后续安装替换则跳过。脚本接受 `-WhatIf`。

技术边界：文件操作仅接受本扩展设置页转发的白名单动作；Native Messaging 再核对精确来源 ID。没有任意命令、任意下载 URL 或额外管理 HTTP 接口。服务仍只监听 127.0.0.1。未来目录中的链接/重解析点、UNC 和越界路径会拒绝。

接口依据：[Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)、[Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)。模型目录依据 [faster-whisper 官方映射](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/utils.py)，下载版本与逐文件摘要见目录 JSON；未自动下载 large-v3-turbo 权重。
