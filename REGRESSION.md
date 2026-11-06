# 模块回归验收

基线：本轮修改前已验收的 1.0.16 工作区；包含既有未提交文件，不能仅用 HEAD 判断改动。2026-10-29 本轮为图文八项布局与交互调整。

| 改动模块 | 已核实的下游 | 依赖证据 | 必须执行的验收 |
| --- | --- | --- | --- |
| 图文状态与逐图插入 | 图文编辑页、内容分流、保存／生成／导出 | useImageTextStore 的 import 与 addPage 调用，见下面 rg 命令 | npm test；npm run smoke:desktop |
| ImageTextResult 图片详情 | ImageTextView、HistoryView 图文详情 | 两个页面直接 import 组件 | npm run smoke:desktop；npm run smoke:packaged |
| 图文 IPC 核对日志 | 主进程 runtimeLogger、保存／策划／导出 | main.ts 注册 registerImageTextHandlers，imageTextIpc.ts 调用 onCheck | npm run typecheck；npm run smoke:desktop；npm run smoke:packaged |
| 发布文案与素材入口 | 历史重新编辑、跨进程持久化 | 历史 openImage 和 desktopPersistenceSmoke 的 review 阶段 | npm run smoke:persistence；electron scripts/imageTextRegression.cjs |
| 正式安装包 | 正式 ASAR 的图文与历史、授权入口 | electron-builder.universal.cjs 与 prepareUniversalConfig.cjs | npm run dist:win；npm run smoke:packaged；electron scripts/imageTextRegression.cjs release/win-unpacked/resources/app.asar |

依赖扫描（项目根目录执行）：

~~~powershell
rg -n 'useImageTextStore|ImageTextResult|registerImageTextHandlers|onCheck|addPage' src electron
~~~

传播规则：组件／状态／IPC 的可观察行为变更必须执行相关下游；本轮未豁免上述下游。不启动开发服务，不调用商业供应商，不接触真实账号和业务库。桌面脚本使用临时目录、隔离授权服务及供应商样本，复制内容由测试截获。打包阶段只下载构建依赖（若本机缺失），正式入口保持远程授权。

测试点：F01–F05 保留旧故障回归；U01 单行顶栏与长链接、U02 版本位置、U03 发布文案编辑／复制／保存重开且不生图、U04 隐藏自动检查与日志白名单、U06 前后插图与边界、U08 历史图片固定／长文独立滚动。源码证据见 docs/图文流程排查证据/2026-10-29-三模块布局/layout.json 和 2026-10-29-回归/regression.json；正式证据见 release/three-module-layout-1.0.17/layout.json 与 release/image-text-regression-1.0.17/regression.json。

本轮命令退出码与包哈希统一登记在 release/universal-package-acceptance-1.0.17.json；未完成前不得将本轮标为全部通过。

## 1.0.17 最终审计

以下命令均已实际执行并返回 0：npm run typecheck；npm test（151 项）；npm run build；npm run smoke:persistence（六阶段）；electron scripts/imageTextRegression.cjs（包含完整源码桌面验收及 F01–F05）；npm run dist:win；npm run smoke:packaged；electron scripts/imageTextRegression.cjs release/win-unpacked/resources/app.asar。源码与正式 ASAR 均为 39 项布局／交互检查。正式回归截图最终顺序生成，避免共享证据文件互相覆盖。tsc -p tsconfig.node.json 已恢复本地开发授权编译入口，正式 ASAR 保持远程授权。


## 2026-10-29 通用 API 设置与 Seedream（源码）

基线：本次 API 修改前已验收的 1.0.17 工作区，含既有未提交内容。不得以 HEAD 覆盖或清理；同一工作区并行出现的知识库优化保留，本轮最终检查针对当前合并工作区。旧包 1.0.17 的验收记录不用于证明本次源码已打包。

| 改动模块 | 已核实下游 | 依赖证据 | 验收命令 |
| --- | --- | --- | --- |
| providerConfig／LocalProviderService／ProviderSettingsForm | 设置页、主进程保存与测试、跨重启读取 | 字段白名单、SettingsView import、main providers IPC | npm run typecheck；npm test；electron scripts/providerSettingsSmoke.cjs；npm run smoke:persistence |
| 通用图片服务／旧 Agnes 入口 | 图文生成 IPC、逐页优化、历史与版本、整套停止／重试 | imageTextIpc import generateImageTextImage；store IMAGE 错误码分支 | npm test；electron scripts/providerSettingsSmoke.cjs；electron scripts/imageTextRegression.cjs |
| 提取预设可编辑地址 | 视频工作台、小红书图文分流与连接测试 | main 与 providerConnectionTest 调用 parseShortVideoLink，向 LinkDigest／姚安适配传地址 | npm test；npm run smoke:persistence；electron scripts/imageTextRegression.cjs |

复核依赖的命令：

~~~powershell
rg -n 'providerConfig|localProviderService|imageGenerationService|testProviderModule|saveProviderModule|parseShortVideoLink|ProviderSettingsForm' electron src tests scripts
~~~

传播规则：本轮改变公开字段、IPC 和请求协议，所有上述下游均须通过；不豁免。正式打包不在本次范围。全部桌面测试使用临时 userData 和协议样本，不调用真实商业服务。

保护点：P01–P11（tests/providerModules.test.ts）覆盖独立保存、加密兼容、测试不落盘、换厂商密钥、Seedream 八比例／参考图／错误码、旧提取地址迁移及无密钥协议；两个提取适配测试覆盖可编辑基础地址实际用于提交、轮询和平台路由；F05 同时覆盖 AGNES 与 IMAGE 三种全局停止码。新增设置桌面验收覆盖三卡片的实际 React／IPC 操作和系统加密，证据目录为 docs/图文流程排查证据/2026-10-29-通用接口/。

最终执行结果（全部为实际退出码）：

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| npm run typecheck | 0 | 前端、Electron 与授权服务类型检查 |
| node --import tsx --test --test-concurrency=2 --test-timeout=30000 tests/*.test.ts | 0 | 169 项全通过 |
| npm run build | 0 | 当前源码构建完成 |
| electron scripts/providerSettingsSmoke.cjs | 0 | 13 项桌面交互，6 次隔离协议请求，商业调用 0 |
| npm run smoke:persistence | 0 | seed／edit／verify／linkdigest／review／fresh 六阶段 |
| electron scripts/imageTextRegression.cjs | 0 | 包含完整源码桌面验收、39 项布局／交互和 F01–F05 |
| git diff --check | 0 | 无差异空白错误 |

失败及重跑记录：中间一次默认并发 npm test 返回 168 通过、1 失败，tests/remoteAuthNetwork.test.ts 的 fixture 初始化登录触发既有 200ms 超时；fixture 在登录失败后没有返回供 finally dispose 的对象，测试服务器导致进程未退出，已终止该测试子进程。未修改授权业务或此测试；同一完整用例集限制并发并增加单测超时后 169 项通过。中间构建曾遇到并行知识库改动的缺失／重复导入，合并工作区最终已消除。桌面验收中的旧测试图片无法原生解码、旧历史读取入口、跨域预设未填测试 Key 等问题已修正并完整重跑，不降低产品断言。

源码详细记录见 docs/图文流程排查证据/2026-10-29-通用接口/verification.json。真实付费接口和成品质量未验收，未重新生成安装包。



## 2026-10-29 通用版 1.0.18 安装包验收

基线为本次打包前已完成通用 API 与 Seedream 的 1.0.17 工作区，包含既有未提交内容及知识库优化。package.json 与锁文件升为 1.0.18；仅扩展 providerSettingsSmoke.cjs 以接受正式 ASAR，使用临时账号授权服务及协议样本验证包内设置页。打包前后 79 个构建输入哈希一致，无新增产品逻辑变更。未改 docs/工作交接.md。

传播范围为正式 ASAR 中的设置配置、提取分流、图片生成、历史、权限及持久化；沿用上表依赖，无下游豁免。未启动前端开发服务，未调用商业供应商或访问生产业务数据。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| npm run typecheck | 0 | 前端、Electron 与授权服务类型检查 |
| node --import tsx --test --test-concurrency=2 --test-timeout=30000 tests/*.test.ts | 0 | 169 项通过，0 失败 |
| npm run build:auth | 0 | 仅用于临时授权服务验收 |
| npm run build | 0 | 生产资源构建 |
| electron scripts/providerSettingsSmoke.cjs | 0 | 13 项，6 次隔离供应商调用 |
| npm run smoke:persistence | 0 | 六阶段、五次重启 |
| electron scripts/imageTextRegression.cjs | 0 | 完整源码桌面验收、39 项布局与 F01–F05 |
| npm run dist:win | 0 | Windows x64 NSIS 通用包 |
| npm run smoke:packaged | 0 | 包内登录、角色权限、提取、图文、历史与导出 |
| electron scripts/providerSettingsSmoke.cjs release/win-unpacked/resources/app.asar | 0 | 正式包 13 项，6 次隔离供应商调用 |
| electron scripts/imageTextRegression.cjs release/win-unpacked/resources/app.asar | 0 | 正式包 39 项布局与 F01–F05 |
| tsc -p tsconfig.node.json | 0 | 恢复本机开发授权编译入口，正式 ASAR 保持远程 |
| git diff --check | 0 | 无差异空白错误 |

包内容逐文件比对 37 项通过，远程授权入口及生产地址正确、本机 authService 排除；Electron 运行参数限制符合打包配置。latest.yml 文件名、版本、大小与 SHA-512 一致。安装包版本为 1.0.18；主程序 Windows 文件属性沿用既有 Electron 44.9.3 元数据，应用包内版本为 1.0.18。安装包和主程序均未做代码签名。

正式证据：release/package-content-1.0.18.json、release/provider-settings-1.0.18/acceptance.json、release/three-module-layout-1.0.18/layout.json、release/image-text-regression-1.0.18/regression.json。交付清单和本轮各命令日志见 release/universal-package-acceptance-1.0.18.json。旧 1.0.17 EXE 与 blockmap 已移入回收站，release 仅保留 1.0.18 安装包。真实供应商质量、费用与实体设备安装／升级不在此次自动验收范围。


## 2026-10-30 设置清空、图文布局与历史默认记录

基线为本轮开始前的 1.0.18 已验收工作区，包含既有未提交内容；本轮仅新增 8 个产品文件的必要改动，详见 docs/界面四项优化与验收-2026-10-30.md。范围为源码与构建后桌面验收，未生成新安装包，未改工作交接。

| 模块 | 已核实下游 | 依赖证据 | 本轮验收 |
| --- | --- | --- | --- |
| API 清空与设置表单 | providers IPC、preload、设置 UI、后续接口保存与读取 | resetProviderSettings → providers:reset → LocalProviderService.reset；表单传递 busy 状态并重建输入 | typecheck；完整单测；providerSettingsSmoke；smoke:persistence |
| 图文左右布局 | ImageTextView、HistoryView | 两个页面直接使用 ImageTextResult | build；providerSettingsSmoke；imageTextRegression |
| 历史初始选择与刷新 | useAppStore、混合历史列表、历史重新编辑 | setActiveNav、loadHistoryFromSQLite、HistoryView 的 displayRecords 与点击处理 | 完整单测；providerSettingsSmoke；imageTextRegression |

依赖复核：rg -n 'resetProviderSettings|providers:reset|ImageTextResult|selectedHistoryId|selectLatest' src electron tests scripts。

传播规则：上述源码下游全部验收。正式包未生成，因此本轮不以旧 ASAR 验收替代新代码验收；重打包及正式包验收留在后续打包任务中。所有桌面测试均使用临时数据和隔离供应商样本，未启动前端开发服务。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| npm run typecheck | 0 | 三层类型检查 |
| node --import tsx --test --test-concurrency=2 --test-timeout=30000 tests/*.test.ts | 0 | 173 项全部通过 |
| npm run build | 0 | 最终源码构建 |
| electron scripts/providerSettingsSmoke.cjs | 0 | 21 项，包含正常／取消／无法解密清空、重新填写保存、混合历史最新选择及左右布局 |
| npm run smoke:persistence | 0 | 六阶段跨重启持久化 |
| electron scripts/imageTextRegression.cjs | 0 | 完整桌面流程、39 项布局及 F01–F05 |
| git diff --check | 0 | 无差异空白错误 |

中间失败：首次桌面验收复现默认选择覆盖人工点击，已修复并通过后续桌面与图文回归；另一次失败来自样例复制复用版本主键，仅修正测试标识。原问题断言均保留。最终设置验收 21 项通过。新增 P12／P13 覆盖清空、跨重启、旧 Key 不复活及加密不可用恢复；新增前端用例覆盖历史进入重置及异步视频加载不覆盖图文。

证据：docs/图文流程排查证据/2026-10-30-设置与历史优化/、2026-10-30-三模块布局/、2026-10-30-回归/；汇总为 release/ui-optimization-2026-10-30/verification.json。

## 2026-10-30 通用版 1.0.19 安装包验收

基线为本日四项界面优化已验收的 1.0.18 工作区。最终功能源码已完成 173 项测试、三层类型检查及六阶段持久化（见 release/ui-optimization-2026-10-30/verification.json）；本次仅将 package.json 和锁文件版本升至 1.0.19，并更新交付文档。83 个构建输入在打包前后哈希一致，既有未提交内容保留，工作交接文件哈希未变。

下游与传播规则继续沿用本文件“正式安装包”及“四项界面优化”模块：对新的正式 ASAR 完成设置／历史、图文与视频完整流程、布局和 F01–F05 验收，不使用旧包结果代替。本次没有豁免正式包下游；纯版本修改复用同日最终功能源码的类型检查、173 项测试与持久化证据。所有桌面验收使用临时账号、临时业务库和供应商样本。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| npm run build:auth | 0 | 编译正式包验收所需的隔离授权服务 |
| npm run dist:win | 0 | 生产构建、远程授权入口配置、Windows x64 NSIS 安装包 |
| electron scripts/providerSettingsSmoke.cjs release/win-unpacked/resources/app.asar | 0 | 21 项；6 次隔离协议请求；覆盖四项界面优化 |
| electron scripts/imageTextRegression.cjs release/win-unpacked/resources/app.asar | 0 | 完整桌面流程、39 项布局及 F01–F05 |
| npm run smoke:packaged | 0 | 独立正式包桌面入口复验 |
| tsc -p tsconfig.node.json | 0 | 恢复本机开发编译入口；正式 ASAR 哈希未变 |

包内版本 1.0.19、authMode=remote、生产授权配置及员工授权入口正确，本机 authService 排除。37 个程序文件与构建逐项 SHA-256 一致；API 清空 IPC 与控件包含在包内，两项已删除测试按钮不在正式界面产物中。Electron 运行参数限制符合打包配置。latest.yml 版本、文件名、大小及 SHA-512 一致。安装包及主程序均未做代码签名；主程序 Windows 元数据沿用 Electron 44.9.3，应用包内与安装程序版本为 1.0.19。

旧 1.0.18 EXE 和 blockmap 已移入 Windows 回收站，release 只保留 1.0.19 正式安装包。真实商业接口质量、实体设备安装与升级未纳入本次隔离验收。证据：release/package-content-1.0.19.json、release/provider-settings-1.0.19/acceptance.json、release/three-module-layout-1.0.19/layout.json、release/image-text-regression-1.0.19/regression.json、release/universal-package-acceptance-1.0.19.json。


## 2026-11-02 Agnes／Seedream／GLM 生图厂商（源码）

基线：main 的 a51ee97d6354dbea8766ff7411d7eb95b5868898。变更前仅有两份未跟踪的企业交付手册，本次保留且不纳入改动。成功标准：系统设置不显示“兼容”，三家预设能切换并独立保存；GLM 官方协议返回的图片能落盘、进入历史和单页优化；原 Agnes／Seedream 与图文、视频下游通过回归。GLM 不支持参考图、提示词超过 1000 字符时请求前明确报错，不静默忽略或截断。

| 改动模块 | 已核实的下游 | 依赖证据 | 必须执行的验收 |
| --- | --- | --- | --- |
| providerTypes／providerConfig／LocalProviderService／ProviderSettingsForm | 设置切换、加密保存、重启读取、文本与提取配置 | providerConfig 导入、设置 IPC 注册及表单调用 | npm run typecheck；全量单测；electron scripts/providerSettingsSmoke.cjs；npm run smoke:persistence |
| imageGenerationService | 图文 IPC、资产落盘、历史版本、单页优化 | imageTextIpc 调用 generateImageTextImage、资产 dataURL | 全量单测；npm run build；electron scripts/providerSettingsSmoke.cjs；electron scripts/imageTextRegression.cjs |
| useImageTextStore 的 IMAGE_UNSUPPORTED 停止条件 | 整套生成中止、旧图保留、修改后重试 | generatePages 错误码分支及 ImageTextView 调用 | 全量单测；electron scripts/imageTextRegression.cjs |

依赖复核：

~~~powershell
rg -n 'providerConfig|localProviderService|imageGenerationService|generateImageTextImage|IMAGE_UNSUPPORTED|ProviderSettingsForm|image-text:asset' electron src tests scripts
~~~

传播规则：本轮改变厂商类型、请求协议和错误停止条件，以上下游全部执行，不豁免。验收在项目根目录运行，单测每项超时 30 秒并发 2，桌面脚本使用临时 userData 和隔离协议样本，禁止真实商业接口；生产构建不启动前端服务。正式安装包不在本次范围，现有 1.0.19 安装包不含本次改动。

保护点：G01–G08 为 tests/glmImageService.test.ts；G09 为 tests/imageTextWorkflow.test.ts。覆盖独立厂商密钥、官方请求字段、八种比例、URL 图片下载不带密钥、能力限制、错误分类、取消不落盘、指定页版本和批量停止后重试。

本轮源码验收结果（以下命令均已实际执行）：

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| npm run typecheck | 0 | 前端、Electron、授权服务类型检查 |
| node --import tsx --test --test-concurrency=2 --test-timeout=30000 tests/*.test.ts | 0 | 182 项通过，0 失败 |
| npm run build | 0 | 生产构建成功；保留既有块体积提示 |
| electron scripts/providerSettingsSmoke.cjs | 0 | 27 项桌面检查，10 次隔离请求；GLM 保存、落盘和单页优化 |
| electron scripts/imageTextRegression.cjs | 0 | 完整图文与视频桌面流程、39 项布局、F01–F05 |
| npm run smoke:persistence | 0 | seed／edit／verify／linkdigest／review／fresh 六阶段 |
| git diff --check | 0 | 无差异空白错误 |

中间失败：新增桌面用例三次在优化按钮定位失败，诊断确认 Toast 也有 role=dialog。选择器限定真实 .dialog-popup 后通过，同时将新增版本检查改为实际的草稿顶层 versions，保留原有业务断言。失败样本记录在本轮三厂商证据目录的 failed-attempt-dialog-selector.json，未将中间失败视为产品通过。

本轮源码证据使用 2026-11-02-三厂商设置／2026-11-02-三模块布局／2026-11-02-回归 目录，未覆盖旧日期截图与回归文件。跨重启例行输出另复制至本轮 persistence-acceptance.json。汇总见 docs/图文流程排查证据/2026-11-02-三厂商设置/verification.json；使用说明见 docs/三厂商生图适配与验收-2026-11-02.md。真实付费效果未验收，现有正式安装包未更新。


## 2026-11-02 删除图片后跳转与三家连通性

基线：本次删除修复前的 1.0.19 源码工作区，包含上轮未提交的三厂商适配；保留用户新增手册和其他体验证据，不按 HEAD 覆盖已有修改。成功标准：删除当前图片选择原下一张，删除末张选择前一张，连续删除不回首图；保留最后一张、任务锁及其他图片内容和版本。

| 改动模块 | 已核实下游 | 依赖证据 | 验收命令 |
| --- | --- | --- | --- |
| useImageTextStore.removePage | ImageTextView 逐图编辑、ImageTextResult 翻页与内容、图文保存和历史 | ImageTextView 删除按钮调用 state.removePage；activePageId 同时传入预览和编辑区 | 全量单测；npm run typecheck；npm run build；electron scripts/imageTextRegression.cjs；npm run smoke:persistence |

依赖复核：

~~~powershell
rg -n 'removePage|删除当前图|activePageId|saveImageTextHistory' src/store/useImageTextStore.ts src/views/ImageTextView.tsx src/components/imageText/ImageTextResult.tsx
~~~

传播规则：删除改变公开选中状态，上述下游全部执行。未修改厂商协议和设置表单，复用同日上轮 27 项设置验收；本轮完整单测仍覆盖三家协议。正式安装包未修改，不执行打包验收。桌面业务回归使用隔离样本和临时业务库，不访问真实业务数据；用户本次另授权三家连通性测试，因此只读本机图片配置并进行真实接口网络检查，不改写保存配置、不跨厂商发送密钥。

复现与保护点：旧逻辑每次设 activePageId=pages[0].id。修复前 D01 复现实际 page-one／预期 page-three，D03 复现无效页面删除也改变状态；初次 3 项中 2 项失败，退出 1。修复后 D01–D03 全部通过，覆盖连续中间删除、首图／末图、非当前页／无效 ID、最后一张及生成任务锁。桌面新增 D01-delete-next 验证删除后直接显示原下一张内容，D02-delete-last 验证连续 4 次末张删除均选择前一张；原断言保留。

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| npm run typecheck | 0 | 三层类型检查通过 |
| node --import tsx --test --test-concurrency=2 --test-timeout=30000 tests/*.test.ts | 0 | 185 项通过，0 失败 |
| npm run build | 0 | 生产构建通过，既有块体积提示保留 |
| electron scripts/imageTextRegression.cjs | 0 | 完整图文／视频流程、41 项布局与交互、F01–F05 |
| npm run smoke:persistence | 0 | seed／edit／verify／linkdigest／review／fresh 六阶段 |
| Electron 隔离连通性诊断 | 0 | 诊断完成；三家无鉴权 POST 均为 HTTP 401，未完成实际生图验证 |
| git diff --check | 0 | 无差异空白错误 |

连通性结论：本机保存的配置没有可用于这三家的图片密钥。Agnes、Seedream、GLM 的正式 POST 地址均返回 401，网络请求可到达鉴权环节；未发送有效生图任务，不能据此判定模型、权限或额度可用。Agnes 首次 HEAD 为 404，随后按正式 POST 方法复核为 401，未将 HEAD 结果认定为接口地址错误。完成三家鉴权与实际生图仍需各自有效 API Key。读取前后加密配置文件哈希一致。

证据目录：docs/图文流程排查证据/2026-11-02-删除跳转/（verification.json、live-provider-connectivity.json、HEAD 复核前记录、持久化回执）；2026-11-02-删除跳转-三模块布局/layout.json；2026-11-02-删除跳转-回归/regression.json。新目录不覆盖上一轮证据。当前 1.0.19 安装包不含本次删除修复。


## 2026-11-02 三厂商与删除跳转 1.0.20 安装包验收

基线：本日已通过 185 项单测、类型检查、生产构建、41 项桌面布局交互、F01–F05 和六阶段持久化的源码工作区（见 docs/图文流程排查证据/2026-11-02-删除跳转/verification.json）。本轮仅更新版本与交付文档，保留上轮未提交的三厂商适配与删除修复，以及无关用户手册和体验证据。

成功标准：新 Windows x64 NSIS 安装包版本为 1.0.20，使用远程授权与原生产地址；包含 Agnes／Seedream／GLM 设置、GLM 图片下载和单页优化、删除选中下一张／末张选前一张。正式 ASAR 的设置及完整图文／视频下游验收通过；包内容和构建一致；最新版校验信息正确；完成后 release 仅保留一个正式安装包。

传播规则：沿用本文件正式安装包模块，版本及构建变化必须重新执行正式 ASAR 下游；不豁免。纯版本修改复用本日已通过的功能源码测试与持久化结果，打包输入在构建前后校验哈希。

本轮命令：npm run build:auth；npm run dist:win；electron scripts/providerSettingsSmoke.cjs release/win-unpacked/resources/app.asar；electron scripts/imageTextRegression.cjs release/win-unpacked/resources/app.asar；npm run smoke:packaged；tsc -p tsconfig.node.json（验收后恢复开发入口）；git diff --check。验收脚本为临时 userData、隔离授权及供应商样本，不访问生产业务库、不新增商业调用。构建按现有配置下载所需工具，命令日志保留于 release。

验证结果：

- `npm run build:auth`：退出 0；`npm run dist:win`：退出 0，生成 1.0.20 Windows x64 NSIS 安装包。
- `electron scripts/providerSettingsSmoke.cjs release/win-unpacked/resources/app.asar`：首次退出 1，GLM 保存后重开设置时表单尚在加载；验收脚本补充等待三张设置表单加载完成，保留原业务断言。重跑退出 0，27 项通过、10 次隔离协议请求。失败截图和记录保留在 `release/provider-settings-1.0.20/failed-attempt-settings-load.*`。
- `electron scripts/imageTextRegression.cjs release/win-unpacked/resources/app.asar`：退出 0；41 项布局交互及 F01–F05 全部通过，其中 D01 验证删除中间图选中原下一张，D02 验证连续删除末图选中前一张。
- `npm run smoke:packaged`：退出 0，正式包桌面入口和完整图文／视频下游通过。
- 包内容审计临时脚本：最终退出 0，37 个生产文件哈希一致、远程授权与 Electron fuses 正确、无业务数据或密钥、`latest.yml` 文件名／版本／大小／SHA-512 一致。首次审计分别遇到 Windows ASAR 路径分隔符和动态按钮文字匹配问题，修正审计逻辑后通过；未改产品代码。88 项构建输入校验无产品源码变化，仅登记上述验收脚本等待调整。
- `tsc -p tsconfig.node.json`：退出 0，开发入口已恢复，正式 ASAR 前后 SHA-256 均为 `315c50981ce3e970a9b3e57527d0ccdeab0dd65a9b2b5ca968039c5d497a611a`。

交付汇总见 `release/universal-package-acceptance-1.0.20.json`。实际供应商鉴权与生图未验证（本机未配置图片 API Key）；Windows 签名状态为 `NotSigned`。185 项源码单测、类型检查和六阶段持久化复用本日最终功能记录，本轮未重复。

旧包处理：新包验收通过后，旧 1.0.19 EXE 与对应 blockmap 已移入 Windows 回收站，未清空回收站；release 根目录只保留 1.0.20 正式安装包。交接文档与两份企业交付手册哈希均与本轮开始一致。证据见 `release/old-installer-recycle-1.0.20.json`。

最终范围检查：`git diff --check` 退出 0。版本仅由 1.0.19 更新至 1.0.20，依赖未变；本轮打包未改产品源码，仅修正一处验收脚本加载等待并更新交付资料。


## 2026-11-02 授权临时超时修复与 1.0.21 交付

基线：HEAD `a51ee97d6354dbea8766ff7411d7eb95b5868898` 加已有未提交的三厂商与删除跳转改动；沿用 1.0.20 的 185 项单测及正式包绿色基线。修改前文件哈希见 `docs/图文流程排查证据/2026-11-02-授权超时修复/baseline.json`。本轮新增 AUTH-NET-01～07（共 9 项）保护身份查询重试、任务不重提、连续失败有界、真实失效即时处理、写请求不重提及会话切换安全。修改产品实现前 AUTH-NET-01／02 的 3 项核心用例均失败，命令退出 1，原始输出见同目录 `before-fix.log`。

成功标准：仅只读 me 请求的 AUTH_UNAVAILABLE 在 250 ms 后重试一次；每次保留 5000 ms 超时；恢复后继续原任务；连续两次失败中断但保留会话；ACCOUNT_DISABLED／AUTH_REQUIRED 不重试；写请求不重提；退出或更换会话后不再查询旧身份。每次授权请求记录路由、耗时、initial／retry 和失败类型，不能记录令牌、密码或响应正文。服务器 Caddy 增加有容量上限的脱敏访问日志，配置验证后 reload，再实际验证健康与日志无授权头／查询参数。

下游消费者：employeeAuth／desktopAuth → main.withTask 与空闲授权检查 → LinkDigest、图文策划／生图、视频生成、设置和账号管理。依赖证据：`rg -n "RemoteAuthService|runAuthorizedTask|watchSession|requireUser|withTask" electron/main.ts electron/services/employeeAuth.ts electron/services/desktopAuth.ts electron/services/imageTextIpc.ts`。传播规则：身份检查属于所有任务公共入口，本轮不豁免图文／视频桌面、持久化及正式包回归。

有界命令：`node --import tsx --test --test-timeout=30000 tests/remoteAuthNetwork.test.ts`；`npm run typecheck`；`node --import tsx --test --test-concurrency=2 --test-timeout=30000 tests/*.test.ts`；`npm run build`；`electron scripts/imageTextRegression.cjs`；`npm run smoke:persistence`；`npm run build:auth`；`npm run dist:win`；`electron scripts/providerSettingsSmoke.cjs release/win-unpacked/resources/app.asar`；`electron scripts/imageTextRegression.cjs release/win-unpacked/resources/app.asar`；`npm run smoke:packaged`；`tsc -p tsconfig.node.json`（恢复开发入口）；`git diff --check`。全部在本项目执行，单测每项最多 30 秒；构建和桌面命令设总时限并保存退出码。隔离桌面验收只使用临时 userData 与协议样本，不访问生产业务库、不新增商业调用、不启动前端开发服务。构建允许下载现有依赖的构建工具。服务器仅修改并 reload Caddy 日志配置，不修改授权服务代码、账号或业务数据。交接文档和两份用户手册保持哈希一致。

本轮最终结果：授权网络 17 项通过，全项目单测 194 项通过／0 失败；类型检查、源码构建、源码图文／视频完整回归与六阶段持久化均退出 0。源码回归使用临时证据包装脚本，将证据写入本轮独立目录，不覆盖删除跳转历史证据；包装脚本和执行日志已保存。

正式交付：`npm run build:auth`、`npm run dist:win`、设置正式包 27 项检查、图文／视频正式包 41 项布局交互与 F01–F05、`npm run smoke:packaged`、包内容审计、恢复开发入口均退出 0。37 个生产文件哈希与构建一致，88 个构建输入未变，远程授权入口／fuses／latest.yml 校验通过，ASAR 恢复开发入口前后 SHA-256 均为 `9936155c5e280e2472bbd6fdfe74cab961d4fd3b746bf7044043d5edb44c2697`。安装包 1.0.21，137.7 MiB，SHA-256 `fd3390d87f2dafbb7282417969d152ad1d96fcaf9d6f798624d0d1af823a0c55`；Windows 签名状态 NotSigned。旧 1.0.20 EXE 与 blockmap 已移入回收站，release 仅保留新包；未自动安装、未提交推送。

异常记录：正式包首轮在历史删除完成后等待弹窗消失超时（退出 1）。带失败现场采集的复跑、原脚本复跑与最终正式入口检查均退出 0；未修改删除产品逻辑、原断言或等待上限。该单次等待未复现，原因未确认，失败输出与当时布局证据保留在本轮 `packaged-first-attempt/`。源码临时包装脚本首次引号错误已修正；Caddy 首次探针误带查询参数，因精确路由返回 404，已回滚，再修正探针并完成正式应用；均保留原始记录，不把探针错误视为产品健康故障。

服务器结果：Caddy v2.11.4 配置备份为 `/etc/caddy/Caddyfile.pre-auth-log-20261102T080853Z`；以 caddy 用户验证通过后 reload，服务 PID 和重启次数不变。单文件 5 MiB、4 份归档、最长 14 天；实际验证去除请求头、响应头及 URI 查询参数；日志文件属主 caddy、权限 0600。公网最终 /health 返回 200。旧故障窗口缺少访问日志，单次超时发生在哪一层仍无法倒查，不将当前健康结果解释为永久消除网络故障。

完整回执：`docs/图文流程排查证据/2026-11-02-授权超时修复/verification.json`；正式包审计 `release/package-content-1.0.21.json`。交接文档与两份企业交付手册哈希一致，既有三厂商与删除跳转改动保留；未产生额外商业调用。


## 2026-11-04 授权检查间隔与有界宽限

基线：1.0.21 当前工作区，保留既有三厂商、删除跳转和授权重试改动；本轮文件哈希见 docs/图文流程排查证据/2026-11-04-授权宽限/baseline.json。

成功标准：任务内默认每 15 秒检查、空闲仍 30 秒；同会话身份查询在途合并，不缓存为新任务授权；仅临时 AUTH_UNAVAILABLE 可保护已提交任务，期限为最近一次服务端授权成功后 60 秒，失败不续期。开始任务前必须实时授权成功；正在等待的新图片只重查授权，恢复后只提交一次；超期、明确停用、会话失效、退出与取消立即停止本地等待；成功图片先归档并能返回，结束校验临时失败在宽限内不丢结果。

依赖证据：rg -n "runAuthorizedTask|watchSession|requireUser|withTask|image-text:generate|saveImageTextHistory" electron/main.ts electron/services/remoteAuthService.ts electron/services/imageTextIpc.ts src/store/useImageTextStore.ts。下游：远程登录与账号管理、空闲校验、LinkDigest、文本生成、图文策划与生成、历史保存和取消。传播规则：授权公开行为变化，以下下游全部执行，不豁免；不启动前端服务、不调用真实付费接口、不修改生产服务器与业务数据。

步骤 → 验证方式：先以隔离 HTTP 授权样本补故障与取消测试并记录红色基线；再修改授权和图片结果传递，跑授权网络测试、相关图文测试；最后执行 npm run typecheck、全量 node --import tsx --test --test-concurrency=2 --test-timeout=30000 tests/*.test.ts、npm run build、隔离 electron scripts/imageTextRegression.cjs、npm run smoke:persistence、git diff --check。截图与回执写新日期目录，不覆盖历史证据。本轮不更新安装包或提交推送。

本轮结果：新增故障测试修改前共 49 项，38 通过／11 失败；修复后最终全量 207 项通过，退出 0。npm run typecheck、npm run build、隔离远程授权 Electron 桌面回归、npm run smoke:persistence、git diff --check 均退出 0。桌面覆盖 4 项授权恢复／取消／结果保护／截止用例、41 项布局交互及 F01–F05；故障时间在隔离桌面样本中缩短为 50 ms 检查／1600 ms 宽限，源码默认 15 秒／60 秒已核对；默认检查间隔由单测验证，宽限边界使用缩短时间参数测试。六阶段持久化通过，既有 release 回执已还原，新回执留在本轮证据目录。

中间失败保留：首轮类型约束问题和旧测试等待上限已修正；第一次桌面窄窗口等待失败，第二次通过并运行完四项授权与 F01–F05 后在历史通用弹窗等待失败。最终临时验收包装限定实际 .dialog-popup、沿用原有内容区缩放方法，保留全部业务断言后通过；未修改产品布局或历史删除逻辑，不声称确认了首轮尺寸等待的产品根因。

源码涉及 remoteAuthService、main 的图文预检入口、imageTextIpc 的取消信号传递、useImageTextStore 的后端归档结果复用，以及两份相关测试与 README。保护文件哈希和现有 1.0.21 安装包哈希不变；不修改服务器，不新增真实商业调用，不打包、安装、提交或推送。完整回执：docs/图文流程排查证据/2026-11-04-授权宽限/verification.json。


## 2026-11-04 GLM 参考图提示与单页优化

成功标准：明确限制属于本软件当前 GLM 接入；只改文字时不自动附带旧图；错误指出参考图来源；本页能力限制不阻断其他页面；旧图与成功页保留，修改后只重试未完成页。

改动：GLM 设置和图文界面按当前接入说明文字输入限制，禁用新增参考与上一版图片参考，保留已有参考的移除和取消绑定。生成前区分整套风格图、本页绑定图及上一版图片；整套风格图继续停止整套任务，本页参考与超长提示词只标记本页失败。单页失败保留具体原因，提示词超限显示实际字符数。

验证：修复前针对性复现了来源提示不明确和单页错误被汇总覆盖。修复后 210 项单测通过；生产构建（含前端、Electron 类型检查）及服务端类型检查通过。隔离 Electron 界面验收 28 项通过，验证 GLM 仅改文字重生成、参考入口禁用、Seedream 默认旧图参考保持可用；10 次供应商请求均为模拟响应，无真实商业调用。新增验收场景最初因辅助函数声明顺序中断，修正脚本后复跑通过。

证据：docs/图文流程排查证据/2026-11-04-GLM参考图/acceptance.json。本次未重新生成安装包。


## 2026-11-04 通用版 1.0.22 安装包

成功标准：Windows x64 NSIS 安装包包含 GLM 参考图提示与单页优化、已有授权恢复改动；沿用远程授权入口与原地址；正式包下游验收通过，安装器载荷与构建一致，更新清单与哈希匹配。

版本和锁文件从 1.0.21 更新至 1.0.22，依赖未变。复用本轮功能收敛后的 210 项全量单测及类型检查；本次执行 npm run build:auth、npm run dist:win，退出均为 0。对正式 ASAR 执行 providerSettingsSmoke.cjs 与 imageTextRegression.cjs，退出均为 0：28 项设置检查、10 次隔离供应商请求、41 项布局交互及 F01–F05 通过；后者包含完整桌面入口与图文／视频流程，无需重复运行相同底层桌面脚本。

包审计通过：37 个生产文件与构建哈希一致，84 个构建输入在打包和验收期间未变；生产授权入口、原地址、排除本机管理员模块及 Electron fuses 符合现有配置。从 NSIS 提取的 ASAR 与主程序分别与验收文件一致；latest.yml 版本、文件名、大小与 SHA-512 一致。临时审计脚本首次因 Windows ASAR 路径分隔符失败，规范化路径后通过，未改产品代码。验收后恢复开发编译入口，正式 ASAR 哈希不变。

安装包：release/video-remix-universal-setup-1.0.22.exe，144422759 字节，SHA-256：1a87c83c7954689f5bc70af291b91eb49ba5b9177ca282cb55b4ce0d81336761。原 1.0.21 安装包和 blockmap 保留到 release/previous/1.0.21，旧包哈希与打包前一致。三份保护文档哈希不变。此次未安装、未修改生产服务器、未新增真实商业调用；沿用未签名配置。

交付回执：release/universal-package-acceptance-1.0.22.json；包内容：release/package-content-1.0.22.json；正式设置与图文回归证据分别位于 release/provider-settings-1.0.22、release/three-module-layout-1.0.22 和 release/image-text-regression-1.0.22。


## 2026-11-04 GLM 参考素材上传入口

成功标准：GLM 下风格参考、实景参考及单页优化上传入口可用；素材落盘并保留，新增实景素材不自动绑定页面；当前 GLM 生图继续遵循文字输入协议。

改动：开放三个上传按钮；GLM 单页优化上传只加入素材库，不默认绑定；界面和设置明确说明素材可保存、当前接入仍不能使用参考图生图。上一版图片参考和后端能力校验保留。

验证：45 项相关单测、npm run build（含前端与 Electron 类型检查）通过；隔离 Electron 界面验收 29 项通过，覆盖实际导入、落盘、绑定状态、上传后的文字生图及三个入口；10 次供应商请求均为模拟响应。首轮新增草稿入口验收样本保存失败，改用独立未生成草稿后通过；产品代码未因该验收问题扩大修改。补齐素材标签选中、按钮可见性及绘制完成等待后复验通过，截图已核对。git diff --check 通过。本次未重新生成安装包。

证据：docs/图文流程排查证据/2026-11-04-GLM上传入口-4e910547/acceptance.json；首轮失败记录保留在 docs/图文流程排查证据/2026-11-04-GLM上传入口/failure.json。


## 2026-11-04 GLM 图生图服务流程

成功标准：沿用 Agnes 的参考图上传、按页绑定与上一版图片优化；参考图作为实际请求文件发送，支持多图；文字生图继续可用；旧图、其他页面和历史版本保留；智谱托管模式保持独立。

改动：新增 glm-sglang 协议与“GLM 图生图服务”配置，按参考图存在与否选择 /images/edits（multipart）或 /images/generations（JSON），读取 Base64 返回并沿用资产和版本保存流程。支持本机回环 HTTP 无鉴权服务与远程 HTTPS 鉴权服务；切换本机服务时不沿用旧供应商图片密钥。GLM 图生图模式启用页面绑定、补传自动绑定和上一版参考，新增接入文档 docs/GLM图生图接入.md。

验证：223 项全量单测通过，其中新增 13 项 GLM 图生图测试，包含本机 HTTP 服务的实际 multipart 收发、文件字节与多图字段验证；npm run build（含前端与 Electron 类型检查）及服务端类型检查通过。构建只有既有的 JS chunk 大于 500 kB 提示。隔离 Electron 界面验收 33 项通过，13 次供应商请求均为模拟响应；覆盖配置持久化、文字生图、整套风格与本页素材、补传自动绑定、仅改文字默认附带旧图、四张参考文件同时提交、旧版本与其他页保留。首次界面流程已通过，但新增截图取到旧合成帧；仅调整验收脚本的动画与绘制等待后复验通过，最终两张新增截图已实际核对。

证据：docs/图文流程排查证据/2026-11-04-GLM图生图流程-c680d7a1/acceptance.json、verification.json、glm-reference-settings.png、glm-reference-optimization.png。

边界：未部署 GPU 服务，未连接真实 GLM 推理服务，尚未验证真实模型的效果与性能；实际使用需要填写已部署服务的地址、模型与对应密钥。本次未升版或更新安装包。


## 2026-11-04 GLM 单套 API 自动切换与图文共同生成

成功标准：GLM 在厂商选择中仅有一个入口，配置一次服务地址、模型和密钥；生成时依据实际附带参考图自动选择文字或图生图请求，参考图与完整本页文字、画面要求和风格同时发送。已有托管及图生图配置可正常恢复，托管模式能力限制保留。

改动：合并厂商下拉与快捷按钮，GLM 服务类型放入一次性的“GLM 接入服务”配置；自动模式明确一套配置即可使用。保留已实现的后端自动路由和 prompt 提交，增强 HTTP 合约和桌面验收，验证同一配置连续完成无图→双参考图加完整文字→无图；更新接入文档。

验证：58 项相关单测通过；npm run build（含前端及 Electron 类型检查）通过，仅有既有的 JS chunk 大于 500 kB 提示；隔离 Electron 界面验收 34 项通过，14 次供应商请求均为模拟响应。真实本机 HTTP 合约使用同一地址、模型和密钥，验证文字及 multipart 两类请求的文字完整性。首次扩展合约因 multipart 将 LF 规范为 CRLF 导致断言失败，只修正测试换行归一化后复验通过，无产品请求逻辑改动。两张配置和优化截图已实际核对。

证据：docs/图文流程排查证据/2026-11-04-GLM单API自动切换-913e6d42/acceptance.json、verification.json、glm-reference-settings.png、glm-reference-optimization.png。

边界：本次未部署或连接真实 GLM 推理服务，未更新安装包。自动切换要求接入服务同时支持文生图与图生图；仅填写智谱托管密钥不能获得参考图能力。只上传保存、未绑定本页的实景图不会自动加入该页请求，与现有 Agnes 的素材绑定规则一致。


## 2026-11-04 通用安装包 1.0.23

成功标准：新版安装器包含 GLM 单套 API 自动切换、参考图与完整文字共同提交和上一版图片优化；保留 1.0.22 旧包；正式包授权模式、载荷和更新清单一致。

改动：package.json 与 package-lock.json 升至 1.0.23，不升级依赖；重新生成正式 NSIS 安装器、blockmap 与 latest.yml。旧安装包和更新清单保留在 release/previous/1.0.22。设置验收首次在两类历史加载完成前切换记录，出现选择等待超时；仅在验收脚本增加等待刷新按钮恢复可用后再切换，未修改产品代码，失败证据保留。

验证：本轮 223 项全量单测通过，npm run build:auth 和 npm run dist:win 通过，包含前端、Electron 及服务端类型检查。正式 ASAR 设置验收 34 项通过，14 次供应商请求为模拟响应；41 项布局交互、F01–F05 和完整桌面流程通过。GLM 配置与优化截图已实际核对。包内 37 个生产文件与构建逐一比对一致，安装器内嵌 ASAR 和主程序与验收文件一致；远程授权模式、正式授权地址和 Electron fuses 检查通过，latest.yml 的版本、大小与 SHA-512 正确。开发编译入口已恢复，正式 ASAR 校验值未改变。

安装包：release/video-remix-universal-setup-1.0.23.exe，144424092 字节，SHA-256：60baddbdc75ca76e02082e8204d2f45a4e8d17a8d388d9b42d6dc4de34d83291。

证据：release/universal-package-acceptance-1.0.23.json、release/package-content-1.0.23.json、release/provider-settings-1.0.23/acceptance.json、release/three-module-layout-1.0.23/layout.json、release/image-text-regression-1.0.23/regression.json。首次设置验收证据：release/provider-settings-1.0.23-initial-failure/failure.json。

边界：未部署或连接真实 GLM 推理服务，未执行真实设备安装升级；参考图生成需要接入支持该能力的服务，仅智谱托管密钥无法开启。


## 2026-11-04 撤回 GLM 参考图流程（1.0.24）

本条覆盖当前产品行为。上方 GLM 图生图、单 API 自动切换与 1.0.23 交付记录及其证据保留为历史事实，相关功能在 1.0.24 撤回。

成功标准：移除图生图配置、自动路由、multipart 请求及专属说明；GLM 只保留官方文字生图并关闭参考图上传和上一版图片参考入口；旧绑定可取消，Agnes／Seedream 参考图能力、历史素材及其他模块配置保留。读取旧 glm-sglang 配置时，只迁移图片字段为官方文字预设并清除旧图片密钥，通过原系统加密存储落盘。

验证结果与交付校验值待本轮统一验证后补充。


## 2026-11-04 Sub2API 异步生图预设安装包（1.0.25）

成功标准：正式安装包包含 Sub2API 独立预设、文字生图、参考图与完整文字共同提交、同一 Key 异步轮询和结果保存；GLM 继续使用官方文字生图。保留 1.0.24 安装包与更新清单，正式包授权配置与既有版本一致。

变更：package.json 与锁文件升级至 1.0.25；沿用上轮通过验证的功能源码。本轮核对 9 个源码／测试／验收脚本哈希后复用 233 项完整测试通过结果，未重复执行单测；记录并核对 79 个构建输入未变化。

验证：npm run build:auth、npm run dist:win 通过。正式 ASAR 的 33 项设置验收通过（18 次模拟供应商请求，含 Sub2API 文生图与 multipart 参考图编辑）、41 项布局检查和 F01–F05 回归通过。39 个包内产物与构建文件一致，安装器内嵌 ASAR 与主程序和已验收版本一致；Electron fuses、远程授权模式、正式授权地址和 latest.yml 的版本／大小／SHA-512 核对通过。打包后恢复开发授权入口，正式 ASAR 哈希不变。

交付：release/video-remix-universal-setup-1.0.25.exe，144429344 字节（137.7 MiB），SHA-256：e77aba7843cd57db3336a52499f9d003d951ebdd8e22739db66a2715e0abf2f1。旧包 release/previous/1.0.24/video-remix-universal-setup-1.0.24.exe 及其 blockmap、更新清单已备份并校验。验收记录：release/universal-package-acceptance-1.0.25.json；截图：release/provider-settings-1.0.25/sub2api-settings.png。

边界：未调用真实付费生图服务，未改生产授权服务或用户业务数据，未执行本机安装升级。


## 2026-11-05 员工安装包 1.0.26

管理员停用清理功能已打入远程授权通用版。npm test：254 项通过、0 失败；npm run dist:win 与 npm run build:auth 均成功，包含前端、Electron 与服务端类型编译。正式 ASAR 的 9 项清理验收通过，覆盖主动退出／同设备换号／密码重置保留配置、停用清理、管理员配置与员工业务资料保留、重新启用不恢复密钥及 WASM 迁移。

正式包另通过 33 项设置检查、41 项布局检查及 F01–F05 回归。安装器解包后的 ASAR、执行文件及 88 个外置运行文件与验收版本一致；40 个应用文件与构建输出一致，124 个输入文件哈希未变化，运行保护及更新清单校验通过。开发用本机授权入口已恢复，正式 ASAR 哈希保持不变。证据：release/universal-package-acceptance-1.0.26.json。本次未执行真实员工设备安装或真实供应商调用。

## 2026-11-05 首次安装授权服务器绑定（1.0.27）

变更：新安装在 NSIS 向导填写并验证 HTTPS 根地址，检查健康和未登录授权协议；确认后固化本机绑定。覆盖升级保留绑定和 API 设置，主动卸载清除绑定、加密 API 配置及清理进度，不删除业务资料。旧固定地址升级沿用构建时兼容地址。首次静默安装拒绝跳过绑定，缺失或损坏的绑定拒绝启动。

验证：类型检查通过；完整测试 258/258 通过，含 PowerShell 12 场景；独立临时目录执行实际 NSIS 钩子 6 场景通过；computer-use 可访问性树验证地址页面、HTTP 拦截、HTTPS 接口校验及确认绑定落盘。截图捕获超时后改用可访问性树；界面验收完成后用户以 Esc 停止电脑操作。正式 ASAR 桌面验收及 API 设置 33 场景通过，18 次供应商请求均为隔离模拟响应。安装包构建成功，大小和 SHA-256 见 release/universal-package-acceptance-1.0.27.json。未升级本机生产客户端，未修改线上服务。
