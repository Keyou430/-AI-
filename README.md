# 视频二创 AI 助手

面向企业新媒体团队的桌面创作工具：提取抖音、小红书视频文案，结合公司业务与本地知识库生成分镜脚本。

## 已有功能

- 一键提取并二创、人工编辑后再二创；流式输出拍摄脚本与口播稿。
- PDF、DOCX、TXT、MD、CSV 知识库解析与启停；企业业务关键词注入。
- 多轮优化、脚本与对话上下文版本回退。
- SQLite 历史记录、平台筛选、关键词检索、重新编辑及 TXT / Word 兼容文档导出。
- 首次管理员初始化、账号登录、新增成员与管理员、启停账号和重置密码。
- 主进程按窗口绑定会话；业务请求实时校验账号状态，管理接口校验管理员角色。

账号、历史与知识库保存在本机。账号之间共享业务数据；暂不支持跨电脑账号同步。
Word 导出为 UTF-8 HTML 兼容的 .doc 文件，不是原生 .docx。

## 技术栈

Electron、React 18、TypeScript、Vite、Tailwind CSS、Radix UI、Zustand；SQLite 优先使用 better-sqlite3，原生模块不可用时使用 sql.js。
AI 调用使用 OpenAI SDK；PDF / Word 解析使用 pdf-parse / mammoth。

## 安装与验证

需要 Node.js 22.12+，持续集成使用 Node.js 24。Windows PowerShell：

~~~powershell
npm ci
npm run typecheck
npm test
npm run build
npm run smoke:desktop
~~~

npm ci 会下载 Electron 运行时。网络无法访问 GitHub 下载时，可根据本机网络设置 ELECTRON_MIRROR 环境变量后重试。
smoke:desktop 使用临时数据库和隐藏窗口，不启动 Vite 服务、不读写实际业务数据。
需交互调试时手动执行 npm run dev:electron。

## 首次登录

首次打开应用时，为内置 admin 账号设置姓名和至少 8 位密码。没有默认密码。
登录后在“账号管理”中新增成员、设置角色、停用账号或重置密码。
内置管理员和当前操作账号不能被停用；密码重置后该账号已有会话失效。

## 真实接口配置

默认开启仿真模式，使用固定示例数据，不调用外部服务。
在“系统设置”填写有效配置后关闭仿真模式：

1. 模型：填写 API Key、兼容 OpenAI 的 Base URL 和模型名；默认 Base URL 为 DeepSeek。
2. 视频解析：填写已购买服务的解析地址和 API Key。当前适配协议为 POST JSON {"url":"视频链接"}，通过 Authorization: Bearer 传递密钥。
3. 解析响应支持 data 包装，口播字段为 transcript 或 asr_text，画面字段为 visual_summary 或 cover_desc；具体供应商协议不同需增加适配。

主进程也支持 LLM_API_KEY、VIDEO_PARSER_ENDPOINT、VIDEO_PARSER_API_KEY 环境变量。密钥不得写入源码或提交到 Git。
当前测试用本地 HTTP / SSE 服务验证请求与响应协议；未提供有效商业接口凭证，尚未完成第三方生产服务联调。

## Windows 安装包

~~~powershell
npm run dist:win
npm run smoke:packaged
~~~

安装包输出到 release，未进行代码签名。打包时保留 sql.js 作为原生 SQLite 不可用时的运行引擎。
GitHub Actions 在 main 推送及 Pull Request 时执行检查、测试、构建和打包验证，并保存安装包到构建产物。

## 项目资料

- [执行进度与限制](docs/TASKS.md)
- [原始产品需求](docs/PRD.md)
- [原始技术方案](docs/技术栈.md)

原始文档中的规划不等于已实现状态，以执行进度及源码为准。
