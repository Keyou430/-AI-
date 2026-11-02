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
