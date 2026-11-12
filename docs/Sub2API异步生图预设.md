# Sub2API 异步生图预设

在“设置 → 系统设置 → 图片生成”选择“使用 Sub2API（异步生图） 配置”，填写该服务的 API Key 后保存。快捷预设只填表，不自动保存或发送生成请求。

| 配置项 | 默认值 |
| --- | --- |
| 图片厂商 | Sub2API（异步生图） |
| 接口完整地址 | https://www.sevnx.lol/v1/images/generations |
| 模型名称 | gpt-image-2 |
| API Key | 用户自行填写，由原系统密钥存储加密保存 |

地址和模型可编辑。接入服务必须实现用户提供的 Sub2API 异步任务合约；其他 OpenAI 格式接口不保证支持。已包含在 1.0.25 安装包中，1.0.24 及更早安装包未包含此预设。

- 无参考图：JSON 提交 images/generations，包含完整本页提示词、async=true、n=1、quality=medium 和跟随草案比例的像素尺寸。
- 有参考图：自动使用同一地址前缀下的 images/edits，multipart 上传 image[]，同时提交完整本页提示词。整套风格图、本页绑定素材和启用的上一版图片按现有规则合并去重；仅上传但未绑定的实景图不会自动发送。
- 支持 generations/async 与 edits/async 地址；两种操作按是否附图切换，保留代理路径前缀。
- 接受 HTTP 202 后，用提交时的同一 API Key 查询返回的同源 poll_url；按 Retry-After 等待，仅处理 processing、completed、failed。
- completed 后优先读取 result.data[0].url，缺失时使用 image_url。图片下载不携带 API Key，校验实际图片格式和 20 MB 限额后保存到现有素材库与历史。
- 实际尺寸、质量和格式以服务端结果为准。最长等待 30 分钟；取消仅停止本机等待和轮询，服务端任务可能继续执行。
- failed、worker_interrupted、查询 404、网络失败或超时均不自动重提新任务。错误提示后可手动重试；旧图与已成功页面保留。

协议依据：接入服务提供的协议说明。默认域名属于该文档所指的接入服务，使用该服务签发的 Key。

验证不调用真实付费接口：tests/sub2apiImageService.test.ts 覆盖异步状态、multipart 参考图、密钥归属、取消及旧图保留；scripts/providerSettingsSmoke.cjs 覆盖真实设置页面、加密保存、生成 IPC、图片落盘和历史。

本次验证：233 项完整测试串行通过（含新增 20 项），前端与 Electron 构建、服务端类型检查通过；33 项桌面检查通过，18 次供应商请求均为模拟响应。证据见 docs/图文流程排查证据/2026-11-04-Sub2API预设/verification.json、acceptance.json 与 sub2api-settings.png。首轮授权测试端口失败及桌面脚本日志路径修正记录在 verification.json。

1.0.25 安装包：release/video-remix-universal-setup-1.0.25.exe。正式包设置验收 33 项、布局检查 41 项及 F01–F05 回归均通过；包内载荷与安装器内嵌程序逐项核验一致。正式包验收记录：release/universal-package-acceptance-1.0.25.json。
