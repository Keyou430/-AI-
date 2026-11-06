// 构建后运行：electron scripts/providerSettingsSmoke.cjs [app.asar]。使用临时数据和协议样本，禁止真实网络。
const { app, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sourceRoot = path.resolve(__dirname, '..');
const applicationPath = path.resolve(process.argv[2] || sourceRoot);
const metadata = require(path.join(applicationPath, 'package.json'));
const remotePackage = metadata.authMode === 'remote';
const password = 'Test-' + randomUUID();
let testAuthServer;
let authOrigin;
let fixtureAuthOrigin;
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-provider-settings-'));
const evidenceDirectory = process.env.PROVIDER_SETTINGS_EVIDENCE_DIR || (remotePackage ? path.join(sourceRoot, 'release', 'provider-settings-' + metadata.version)
  : path.join(sourceRoot, 'docs', '图文流程排查证据', '2026-11-02-三厂商设置'));
app.setPath('userData', dataDirectory);
const png = nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4, 255), { width: 32, height: 32 }).toPNG().toString('base64');
const requests = [];
let imageStatus = 200;
const sub2apiTasks = new Map();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const address = new URL(url);
  if (remotePackage && address.origin === authOrigin) return originalFetch(fixtureAuthOrigin + address.pathname + address.search, init);
  const multipart = init?.body instanceof FormData ? init.body : undefined;
  const body = multipart ? Object.fromEntries(multipart) : init?.body ? JSON.parse(String(init.body)) : undefined;
  const headers = new Headers(init?.headers);
  const request = { url, body, key: headers.get('Authorization') };
  requests.push(request);
  if (url === 'https://www.sevnx.lol/v1/images/generations' || url === 'https://www.sevnx.lol/v1/images/edits') {
    assert.equal(request.key, 'Bearer FIXTURE_SUB2API_SECRET');
    assert.equal(String(body.async), 'true'); assert.equal(body.model, 'gpt-image-2');
    assert.equal(body.stream, undefined); assert.equal(body.size, '1024x1024');
    if (url.endsWith('/edits')) {
      assert.ok(multipart); assert.equal(multipart.getAll('image[]').length, 1);
      assert.equal(headers.has('Content-Type'), false);
      assert.deepEqual(Buffer.from(await multipart.getAll('image[]')[0].arrayBuffer()), Buffer.from(png, 'base64'));
    } else assert.equal(headers.get('Content-Type'), 'application/json');
    const id = 'imgtask_sub2api_' + (sub2apiTasks.size + 1); sub2apiTasks.set(id, 0);
    return Response.json({ id, task_id: id, status: 'processing', poll_url: '/v1/images/tasks/' + id }, { status: 202, headers: { 'Retry-After': '0' } });
  }
  if (address.origin === 'https://www.sevnx.lol' && address.pathname.startsWith('/v1/images/tasks/')) {
    assert.equal(request.key, 'Bearer FIXTURE_SUB2API_SECRET'); assert.equal(init?.method, 'GET');
    const id = address.pathname.split('/').pop(); assert.ok(sub2apiTasks.has(id));
    const count = sub2apiTasks.get(id) + 1; sub2apiTasks.set(id, count);
    return Response.json(count === 1 ? { id, status: 'processing' } : { id, status: 'completed', result: { data: [{ url: 'https://sub2api-assets.example/generated.png' }] } }, { headers: { 'Retry-After': '0' } });
  }
  if (url === 'https://sub2api-assets.example/generated.png') {
    assert.equal(request.key, null); assert.equal(init?.redirect, 'error');
    return new Response(Buffer.from(png, 'base64'));
  }
  if (url === 'https://api.deepseek.com/chat/completions') {
    return Response.json({ id: 'fixture', object: 'chat.completion', created: 0, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: '连接成功' }, finish_reason: 'stop' }] });
  }
  if (url === 'https://linkdigest.dev/api/v1/digest') {
    return Response.json({ platform: 'xiaohongshu', title: '提取测试', caption: '原帖文字', transcript: [],
      images: [{ ocr: '图片文字', description: '自然光场景' }], coverage: { images_read: 1, images_total: 1 } });
  }
  if (url === 'https://open.bigmodel.cn/api/paas/v4/images/generations') {
    assert.equal(request.key, 'Bearer FIXTURE_GLM_SECRET');
    assert.deepEqual(Object.keys(body).sort(), ['model', 'prompt', 'size', 'watermark_enabled']);
    assert.equal(body.watermark_enabled, false);
    assert.equal(body.model, 'glm-image'); assert.equal(body.size, '1280x1280');
    return Response.json({ data: [{ url: 'https://glm-images.example/generated.png?signature=fixture' }] });
  }
  if (url === 'https://glm-images.example/generated.png?signature=fixture') {
    assert.equal(request.key, null); assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error');
    return new Response(Buffer.from(png, 'base64'));
  }
  if (url === 'https://ark.cn-beijing.volces.com/api/v3/images/generations' || url === 'https://proxy.example/images') {
    return imageStatus === 200 ? Response.json({ data: [{ b64_json: png }] }) : Response.json({ error: 'PRIVATE_PROVIDER_MESSAGE' }, { status: imageStatus });
  }
  throw new Error('验收禁止真实网络：' + new URL(url).origin);
};
let completed = false;
const cases = [];
const timer = setTimeout(() => { console.error('通用接口桌面验收超时'); app.exit(1); }, 90000);
app.on('browser-window-created', (_event, window) => {
  window.show = () => {};
  window.webContents.setBackgroundThrottling(false);
  window.webContents.once('did-finish-load', async () => {
    const js = async expression => {
      try { return await window.webContents.executeJavaScript(expression); }
      catch (error) { throw new Error("界面脚本执行失败：" + expression, { cause: error }); }
    };
    const call = (method, payload) => js('window.electronAPI[' + JSON.stringify(method) + '](' + (payload === undefined ? '' : JSON.stringify(payload)) + ')');
    const waitFor = async expression => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (await js(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('界面未就绪：' + expression);
    };
    const form = module => 'document.querySelector(' + JSON.stringify('form[data-provider-module="' + module + '"]') + ')';
    const field = (module, name) => form(module) + '.querySelector(' + JSON.stringify('[name="' + name + '"]') + ')';
    const setField = async (module, name, value) => {
      await js('{const el=' + field(module, name) + ';Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,' + JSON.stringify(value) + ');el.dispatchEvent(new Event("input",{bubbles:true}));}');
      await waitFor(field(module, name) + '.value===' + JSON.stringify(value));
    };
    const click = (module, text) => js('Array.from(' + form(module) + '.querySelectorAll("button")).find(el=>el.textContent.trim()===' + JSON.stringify(text) + ').click()');
    const save = async module => {
      await js(form(module) + '.requestSubmit()');
      await waitFor(form(module) + '.innerText.includes("本设备接口配置已加密保存") && !' + form(module) + '.querySelector("fieldset").disabled');
    };
    const test = async (module, text) => {
      if (module === 'llm') {
        await click(module, text);
        await waitFor('!' + form(module) + '.querySelector("fieldset").disabled');
        return;
      }
      // 界面仅保留文本测试；用 IPC 样本继续保护已存在的接口协议。
      const fields = module === 'image' ? ['imageProtocol', 'imageEndpoint', 'imageModel', 'imageApiKey'] : ['videoParserProvider', 'videoParserEndpoint', 'videoParserApiKey'];
      const config = await js('Object.fromEntries(' + JSON.stringify(fields) + '.map(name=>[name,' + form(module) + '.querySelector("[name="+name+"]").value]))');
      return call('testProviderModule', { module, config, ...(module === 'extraction' ? { rawInput: 'https://www.xiaohongshu.com/explore/fixture?xsec_token=fixture' } : {}) });
    };
    const navigate = label => js('document.querySelector("nav button[aria-label=' + label + ']").click()');
    const clickPage = text => js('Array.from(document.querySelectorAll("button")).find(el=>el.textContent.trim()===' + JSON.stringify(text) + ').click()');
    const clickDialog = text => js('Array.from(document.querySelector(".dialog-popup[role=dialog]").querySelectorAll("button")).find(el=>el.textContent.trim()===' + JSON.stringify(text) + ').click()');
    const openSettings = async () => {
      await navigate('设置');
      await js('Array.from(document.querySelectorAll("[role=tab]")).find(el=>el.textContent.trim()==="系统设置").click()');
    };
    try {
      assert.equal((await call('resetProviderSettings')).errorCode, 'AUTH_REQUIRED');
      await waitFor(remotePackage ? 'Boolean(document.querySelector("[name=username]"))' : 'Boolean(document.querySelector("[name=displayName]"))');
      await js((remotePackage ? 'document.querySelector("[name=username]").value="admin";' : 'document.querySelector("[name=displayName]").value="接口验收";') +
        'document.querySelector("[name=password]").value=' + JSON.stringify(password) + ';document.querySelector("form").requestSubmit()');
      await waitFor('Boolean(document.querySelector("nav button[aria-label=设置]"))');
      await js('document.querySelector("nav button[aria-label=设置]").click()');
      await js('Array.from(document.querySelectorAll("[role=tab]")).find(el=>el.textContent.trim()==="系统设置").click()');
      await waitFor('document.querySelectorAll("form[data-provider-module]").length===3');
      await waitFor('document.querySelector("[role=tab][aria-selected=true]").textContent.trim()==="系统设置"');
      cases.push('三模块独立卡片和操作按钮');
      assert.equal(await js('document.body.innerText.includes("兼容")'), false);
      assert.deepEqual(await js('Array.from(' + field('image', 'imageProtocol') + '.options).map(el=>el.textContent)'), ['Agnes', 'Seedream', 'GLM', 'Sub2API（异步生图）']);
      assert.equal(await js('Array.from(' + form('image') + '.querySelectorAll("button")).some(el=>el.textContent.includes("自定义"))'), false);
      cases.push('系统设置有 Agnes、Seedream、GLM、Sub2API 四个厂商入口');
      assert.equal(await js('Array.from(document.querySelectorAll("button")).some(el=>["测试内容提取","测试生成图片"].includes(el.textContent.trim()))'), false);
      assert.equal(await js('Boolean(document.querySelector("[name=providerTestLink]"))'), false);
      assert.equal(await js('Array.from(document.querySelectorAll("button")).filter(el=>el.textContent.trim()==="测试模型连接").length'), 1);
      cases.push('移除内容提取和图片测试按钮、测试链接及样图；保留模型连接测试');
      const before = await call('getProviderSettings');
      await click('image', '使用 Seedream 配置');
      assert.equal(requests.length, 0);
      assert.deepEqual(await call('getProviderSettings'), before);
      assert.equal(await js(field('image', 'imageProtocol') + '.value'), 'seedream');
      cases.push('预设只填表，不保存、不发请求');
      await click('image', '使用 GLM 配置');
      assert.equal(await js(field('image', 'imageEndpoint') + '.value'), 'https://open.bigmodel.cn/api/paas/v4/images/generations');
      assert.equal(await js(field('image', 'imageModel') + '.value'), 'glm-image');
      assert.equal(await js('Boolean(document.querySelector("[data-testid=glm-image-limits]"))'), true);
      await setField('image', 'imageApiKey', 'UNSAVED_GLM_SECRET');
      await js('{const el=' + field('image', 'imageProtocol') + ';el.value="agnes";el.dispatchEvent(new Event("change",{bubbles:true}));}');
      await waitFor(field('image', 'imageEndpoint') + '.value==="https://apihub.agnes-ai.com/v1/images/generations"');
      assert.equal(await js(field('image', 'imageModel') + '.value'), 'agnes-image-2.5-flash');
      assert.equal(await js(field('image', 'imageApiKey') + '.value'), '');
      assert.equal(await js('Boolean(document.querySelector("[data-testid=glm-image-limits]"))'), false);
      await click('image', '使用 Seedream 配置');
      assert.deepEqual(await call('getProviderSettings'), before); assert.equal(requests.length, 0);
      cases.push('三家预设和厂商下拉均联动地址、模型及密钥，GLM 限制清晰提示且切换不保存或请求');

      await click('llm', '使用 DeepSeek 配置');
      await setField('llm', 'llmApiKey', 'FIXTURE_TEXT_SECRET');
      await setField('image', 'imageModel', 'unsaved-image-model');
      await save('llm');
      assert.equal(await js(field('image', 'imageModel') + '.value'), 'unsaved-image-model');
      const savedText = (await call('getProviderSettings')).config;
      await setField('llm', 'llmModel', 'unsaved-text-model');
      await test('llm', '测试模型连接');
      assert.equal(requests.length, 1); assert.equal(requests[0].body.model, 'unsaved-text-model');
      assert.equal(requests[0].key, 'Bearer FIXTURE_TEXT_SECRET');
      assert.match(await js(form('llm') + '.innerText'), /连接成功/);
      assert.equal((await call('getProviderSettings')).config.llmModel, savedText.llmModel);
      cases.push('独立保存保留其他未保存输入；测试使用当前模型和已存密钥且不落盘');

      await click('extraction', '使用 LinkDigest 配置');
      await setField('extraction', 'videoParserApiKey', 'FIXTURE_EXTRACT_SECRET');
      const extracted = await test('extraction');
      assert.equal(requests.length, 2); assert.equal(requests[1].body.url.includes('xsec_token=fixture'), true);
      assert.equal(extracted.success, true, extracted.message);
      assert.equal((await call('getProviderSettings')).config.videoKeyConfigured, false);
      await save('extraction');
      assert.equal(await js(field('llm', 'llmModel') + '.value'), 'unsaved-text-model');
      cases.push('隔离提取适配器连通、链接参数保留，底层测试不自动保存');
      await setField('extraction', 'videoParserEndpoint', 'https://other.example/gateway');
      await setField('extraction', 'videoParserApiKey', 'FIXTURE_PROXY_UNUSED_SECRET');
      await click('extraction', '使用 LinkDigest 配置');
      assert.equal(await js(field('extraction', 'videoParserApiKey') + '.value'), '');
      assert.equal((await call('getProviderSettings')).config.videoParserEndpoint, 'https://linkdigest.dev');
      cases.push('提取预设切换地址时清空表单中其他服务商密钥');

      await click('image', '使用 Seedream 配置');
      await setField('image', 'imageApiKey', 'FIXTURE_IMAGE_SECRET');
      const imageTest = await test('image');
      assert.equal(imageTest.success, true, imageTest.message);
      assert.equal(requests.length, 3); assert.equal(requests[2].body.response_format, 'b64_json');
      assert.equal(nativeImage.createFromDataURL(imageTest.preview).getSize().width, 32);
      assert.equal(await js(form('image') + '.querySelectorAll("img").length'), 0);
      assert.equal((await call('getProviderSettings')).config.imageProtocol, 'agnes');
      assert.equal((await call('listHistoryFromDB')).records.length, 0);
      assert.equal((await call('listImageTextHistory')).data.length, 0);
      await save('image');
      assert.equal(await js(field('llm', 'llmModel') + '.value'), 'unsaved-text-model');
      cases.push('界面不显示测试样图；底层协议不写历史，保存不覆盖其他模块输入');

      const { LocalProviderService } = require(path.join(applicationPath, 'dist-electron/services/localProviderService.js'));
      const { safeStorage } = require('electron');
      const persisted = new LocalProviderService(dataDirectory, safeStorage);
      const privateConfig = persisted.read();
      assert.equal(privateConfig.imageProtocol, 'seedream'); assert.equal(privateConfig.imageApiKey, 'FIXTURE_IMAGE_SECRET');
      const encrypted = fs.readFileSync(path.join(dataDirectory, 'providers.encrypted'));
      const publicConfig = JSON.stringify(await call('getProviderSettings'));
      for (const secret of ['FIXTURE_TEXT_SECRET', 'FIXTURE_EXTRACT_SECRET', 'FIXTURE_IMAGE_SECRET']) {
        assert.equal(encrypted.includes(Buffer.from(secret)), false); assert.equal(publicConfig.includes(secret), false);
      }
      cases.push('系统加密存储可重新读取，公开配置不返回密钥');

      await setField('image', 'imageEndpoint', 'https://proxy.example/images');
      const blockedTest = await test('image');
      assert.equal(requests.length, 3);
      assert.match(blockedTest.error, /更换图片生成服务商/);
      assert.equal((await call('getAuthStatus')).user.role, 'admin');
      await setField('image', 'imageApiKey', 'FIXTURE_PROXY_SECRET');
      const proxyTest = await test('image');
      assert.equal(proxyTest.success, true, proxyTest.message);
      assert.equal(requests.length, 4); assert.equal(requests[3].url, 'https://proxy.example/images');
      assert.equal(requests[3].key, 'Bearer FIXTURE_PROXY_SECRET');
      assert.equal((await call('getProviderSettings')).config.imageEndpoint, privateConfig.imageEndpoint);
      cases.push('跨服务商空密钥测试被阻止；填写新密钥使用当前未保存地址');

      await click('image', '使用 Seedream 配置');
      imageStatus = 403;
      const rejectedImage = await test('image');
      assert.equal(requests.length, 5);
      assert.match(rejectedImage.error, /访问被拒绝/);
      assert.equal((await call('getAuthStatus')).user.role, 'admin');
      assert.equal(await js('document.body.innerText.includes("PRIVATE_PROVIDER_MESSAGE")'), false);
      imageStatus = 200;
      cases.push('接口拒绝不触发员工账号停用，不回显上游正文');

      const draft = { id: 'provider-fixture', createdAt: '2026-10-29T12:00:00.000Z', typeOrigin: 'automatic',
        source: { platform: 'xiaohongshu', extractedUrl: 'https://www.xiaohongshu.com/explore/fixture', title: '桌面收纳', author: '作者', durationSec: 0,
          transcript: '', publishedText: '收纳主题', visualSummary: '', suggestedCameraWork: '', contentKind: 'image-text' },
        title: '桌面收纳', body: '发布正文', tags: ['收纳'], style: '自然光实景', ratio: '1:1', ratioOrigin: '原帖参考图', references: [],
        pages: [{ id: 'page-one', text: '封面文字', visual: '桌面全景', referenceIds: [] }, { id: 'page-two', text: '收纳方法', visual: '桌面近景', referenceIds: [] }], notices: [], confirmed: true };
      const result = await call('generateImageText', { draft, pageId: 'page-two', taskId: randomUUID() });
      assert.equal(result.success, true, result.error); assert.ok(result.data.assetId);
      assert.equal(requests.length, 6); assert.equal(requests[5].body.model, privateConfig.imageModel);
      assert.equal(result.data.draft.pages[0].assetId, undefined); assert.equal(result.data.draft.pages[1].assetId, result.data.assetId);
      assert.equal((await call('listImageTextHistory')).data.length, 1);
      cases.push('已保存 Seedream 配置进入实际逐页生成 IPC，只更新指定页并保存历史');
      await navigate('历史记录');
      await waitFor('document.querySelector("[data-record-id=provider-fixture]")?.getAttribute("aria-pressed")==="true"');
      await clickPage('重新编辑');
      await waitFor('Boolean(document.querySelector("[aria-label=图文结果]"))');
      await js('{const el=document.querySelector("select[aria-label=选择图片]");el.value="page-two";el.dispatchEvent(new Event("change",{bubbles:true}));}');
      await waitFor('Boolean(document.querySelector("[aria-label=图文结果] img"))');
      await clickPage('图片优化'); await waitFor('Boolean(document.querySelector(".dialog-popup[role=dialog]"))');
      await js('{const el=Array.from(document.querySelectorAll(".dialog-popup[role=dialog] label")).find(el=>el.textContent.startsWith("本图文字")).querySelector("textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,"Seedream 仅修改本图文字");el.dispatchEvent(new Event("input",{bubbles:true}));}');
      await waitFor('document.querySelector(".dialog-popup[role=dialog] input[type=checkbox]").checked && !document.querySelector(".dialog-popup[role=dialog] input[type=checkbox]").disabled');
      assert.equal(await js('Array.from(document.querySelectorAll(".dialog-popup[role=dialog] button")).find(el=>el.textContent.includes("为本图补传")).disabled'), false);
      await clickDialog('取消'); await openSettings();
      await waitFor('document.querySelectorAll("form[data-provider-module]").length===3');
      cases.push('Seedream 仅改文字仍默认附带旧图，参考选项与上传保持可用');

      await click('extraction', '自定义接口');
      await setField('extraction', 'videoParserEndpoint', 'https://public.example/read');
      await js('{const el=' + field('extraction', 'videoParserOptions.authMode') + ';Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,"none");el.dispatchEvent(new Event("change",{bubbles:true}));}');
      await save('extraction');
      assert.equal((await call('getProviderSettings')).config.videoKeyConfigured, false);
      assert.equal(await js(form('extraction') + '.querySelector("[role=status]").textContent'), '已配置');
      cases.push('无需密钥的自定义提取接口可切换保存并正确显示已配置');
      await save('image');

      await setField('llm', 'llmModel', savedText.llmModel);
      await js('document.querySelectorAll("[aria-label=关闭提示]").forEach(el=>el.click())');
      window.setSize(1280, 900);
      fs.mkdirSync(evidenceDirectory, { recursive: true });
      await js('document.querySelector(".settings-page").scrollTop=0');
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(evidenceDirectory, 'provider-settings.png'), (await window.webContents.capturePage()).toPNG());
      for (const module of ['extraction', 'image']) {
        await js(form(module) + '.scrollIntoView({block:"start"})');
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(evidenceDirectory, 'provider-' + module + '.png'), (await window.webContents.capturePage()).toPNG());
      }
      window.setSize(900, 900);
      await waitFor('innerWidth<=900');
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
      assert.equal(await js('Array.from(document.querySelectorAll("form[data-provider-module]")).every(el=>el.scrollWidth<=el.clientWidth+1)'), true);
      cases.push('桌面窄窗三卡片无横向溢出');
      const logs = fs.readdirSync(path.join(dataDirectory, 'logs')).filter(file => file.endsWith('.log')).map(file => fs.readFileSync(path.join(dataDirectory, 'logs', file), 'utf8')).join('\n');
      for (const secret of ['FIXTURE_TEXT_SECRET', 'FIXTURE_EXTRACT_SECRET', 'FIXTURE_IMAGE_SECRET', 'FIXTURE_PROXY_SECRET', 'PRIVATE_PROVIDER_MESSAGE']) assert.equal(logs.includes(secret), false);
      cases.push('操作日志不记录密钥或上游正文');

      // 实际页面验证：最新记录可为视频或图文，重新进入不沿用旧选择与筛选。
      const newestVideo = { id: 'latest-video-fixture', title: '最新视频验收', createdAt: '2026-10-30T08:00:00.000Z', platform: 'douyin',
        sourceUrl: 'https://v.douyin.com/fixture', durationSec: 18, userCameraWork: '', originalTranscript: '视频原稿', visualSummary: '',
        rawGeneratedScript: '最新视频内容', parsedStructure: {}, refinementHistory: [], conversationMessages: [] };
      assert.equal((await call('saveHistoryToDB', newestVideo)).success, true);
      await navigate('历史记录');
      await waitFor('document.querySelector("[data-record-id=latest-video-fixture]")?.getAttribute("aria-pressed")==="true" && document.querySelector("[aria-label=历史详情] h2")?.textContent==="最新视频验收"');
      // 最新项可先由回退选择显示，等两类历史加载完成后再切换记录。
      await waitFor('!Array.from(document.querySelectorAll("button")).find(el=>el.textContent.trim()==="刷新").disabled');
      await js('document.querySelector("[data-record-id=provider-fixture]").click()');
      await waitFor('document.querySelector("[data-record-id=provider-fixture]").getAttribute("aria-pressed")==="true"');
      await navigate('设置'); await navigate('历史记录');
      await waitFor('document.querySelector("[data-record-id=latest-video-fixture]")?.getAttribute("aria-pressed")==="true"');
      cases.push('最新记录为视频时自动打开；重新进入不保留旧图文选择');

      const newestImage = { ...structuredClone(result.data.draft), id: 'latest-image-fixture', title: '最新图文验收', createdAt: '2026-10-30T12:00:00.000Z',
        body: '图文长文布局验收。\n'.repeat(180) };
      for (const version of newestImage.versions || []) {
        const previousId = version.id; version.id = randomUUID();
        for (const page of newestImage.pages) if (page.currentVersionId === previousId) page.currentVersionId = version.id;
      }
      newestImage.pages[1].visual = '画面内容布局验收。\n'.repeat(180);
      const savedNewestImage = await call('saveImageTextHistory', newestImage);
      assert.equal(savedNewestImage.success, true, savedNewestImage.error);
      await navigate('设置'); await navigate('历史记录');
      await waitFor('document.querySelector("[data-record-id=latest-image-fixture]")?.getAttribute("aria-pressed")==="true" && Boolean(document.querySelector("[data-testid=image-text-detail-scroll]"))');
      await clickPage('刷新');
      await waitFor('!Array.from(document.querySelectorAll("button")).find(el=>el.textContent.trim()==="刷新").disabled');
      assert.equal(await js('document.querySelector("[data-record-id=latest-image-fixture]").getAttribute("aria-pressed")'), 'true');
      await js('document.querySelector("[aria-label=平台筛选] button[aria-pressed=false]").click()');
      await navigate('设置'); await navigate('历史记录');
      await waitFor('document.querySelector("[data-record-id=latest-image-fixture]")?.getAttribute("aria-pressed")==="true"');
      assert.equal(await js('document.querySelector("[aria-label=平台筛选] [aria-pressed=true]").textContent.trim()'), '全部');
      cases.push('最新记录为图文时自动打开；视频刷新不覆盖选择，重新进入重置旧筛选');

      await clickPage('重新编辑');
      await waitFor('Boolean(document.querySelector("[aria-label=图文结果]"))');
      await js('{const el=document.querySelector("select[aria-label=选择图片]");el.value="page-two";el.dispatchEvent(new Event("change",{bubbles:true}));}');
      await waitFor('Boolean(document.querySelector("[aria-label=图文结果] img"))');
      let narrowRightVerified = false;
      const columns = [];
      for (const width of [1280, 1366, 1440]) {
        window.setContentSize(width, 900);
        await waitFor('innerWidth===' + width);
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const layout = await js('{const root=document.querySelector("[data-testid=image-text-result-scroll]");const a=root.firstElementChild.children[0].getBoundingClientRect();const b=root.firstElementChild.children[1].getBoundingClientRect();({width:root.parentElement.clientWidth,sideBySide:b.x>=a.right,overflow:document.documentElement.scrollWidth>innerWidth})}');
        assert.ok(layout.width >= 520 && layout.sideBySide && !layout.overflow, JSON.stringify(layout));
        if (layout.width < 760) narrowRightVerified = true;
        columns.push({ windowWidth: width, ...layout });
      }
      assert.equal(narrowRightVerified, true);
      await js('document.querySelector("[data-testid=image-text-detail-scroll] details").open=true');
      await js('new Promise(resolve=>requestAnimationFrame(resolve))');
      const scrolling = await js('{const image=document.querySelector("[data-testid=image-text-image-column]");const detail=document.querySelector("[data-testid=image-text-detail-scroll]");const before=image.getBoundingClientRect();detail.scrollTop=detail.scrollHeight;const after=image.getBoundingClientRect();({textScrolled:detail.scrollTop>0,imageFixed:before.y===after.y&&before.height===after.height,imageNoScroll:image.scrollHeight<=image.clientHeight,hasVersion:!!detail.querySelector("select[aria-label=页面版本]")})}');
      assert.ok(scrolling.textScrolled && scrolling.imageFixed && scrolling.imageNoScroll && scrolling.hasVersion, JSON.stringify(scrolling));
      assert.equal(await js('Array.from(document.querySelectorAll("button")).some(el=>el.textContent.trim()==="图片优化")'), true);
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(evidenceDirectory, 'image-text-side-by-side.png'), (await window.webContents.capturePage()).toPNG());
      cases.push('图文右半区与历史统一左图右文；520至760像素容器也左右展示，图片固定文字独立滚动');
      fs.writeFileSync(path.join(evidenceDirectory, 'layout.json'), JSON.stringify({ columns, scrolling }, null, 2), 'utf8');

      await openSettings();
      await waitFor('document.querySelectorAll("form[data-provider-module]").length===3');
      const beforeCancel = fs.readFileSync(path.join(dataDirectory, 'providers.encrypted'));
      await clickPage('清空 API 配置并重新填写');
      await waitFor('Boolean(document.querySelector("[role=dialog]"))');
      await clickDialog('取消');
      await waitFor('!document.querySelector("[role=dialog]")');
      assert.deepEqual(fs.readFileSync(path.join(dataDirectory, 'providers.encrypted')), beforeCancel);
      cases.push('清空需确认，取消后原配置和密钥保留');

      await setField('llm', 'llmApiKey', 'UNSAVED_RESET_FIXTURE');
      await setField('image', 'imageModel', 'unsaved-reset-model');
      await clickPage('清空 API 配置并重新填写');
      await waitFor('Boolean(document.querySelector("[role=dialog]"))');
      await clickDialog('确认清空');
      await waitFor('!document.querySelector("[role=dialog]") && document.querySelectorAll("form[data-provider-module]").length===3');
      const resetConfig = (await call('getProviderSettings')).config;
      assert.equal(resetConfig.llmKeyConfigured, false); assert.equal(resetConfig.videoKeyConfigured, false); assert.equal(resetConfig.imageKeyConfigured, false);
      assert.equal(await js('Array.from(document.querySelectorAll("form[data-provider-module] [role=status]")).every(el=>el.textContent==="未配置")'), true);
      assert.equal(await js(field('llm', 'llmApiKey') + '.value'), '');
      assert.notEqual(await js(field('image', 'imageModel') + '.value'), 'unsaved-reset-model');
      assert.equal((await call('listHistoryFromDB')).records.length, 1); assert.equal((await call('listImageTextHistory')).data.length, 2);
      cases.push('正常清空全部 API、未保存表单和旧密钥，保留视频与图文历史');

      fs.writeFileSync(path.join(dataDirectory, 'providers.encrypted'), 'UNREADABLE_CONFIG_FIXTURE');
      await navigate('二创工作台'); await openSettings();
      await waitFor('document.body.innerText.includes("无法读取本机接口配置")');
      assert.equal(await js('document.querySelectorAll("form[data-provider-module]").length'), 0);
      await clickPage('清空 API 配置并重新填写');
      await waitFor('Boolean(document.querySelector("[role=dialog]"))');
      await clickDialog('确认清空');
      await waitFor('!document.querySelector("[role=dialog]") && document.querySelectorAll("form[data-provider-module]").length===3');
      await click('llm', '使用 DeepSeek 配置'); await setField('llm', 'llmApiKey', 'FIXTURE_RECONFIGURED_SECRET'); await save('llm');
      assert.equal((await call('getProviderSettings')).config.llmKeyConfigured, true);
      assert.equal(new LocalProviderService(dataDirectory, safeStorage).read().llmApiKey, 'FIXTURE_RECONFIGURED_SECRET');
      await waitFor(form('llm') + '.querySelector("[role=status]").textContent==="已配置"');
      await js('document.querySelector(".settings-page").scrollTop=0');
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(evidenceDirectory, 'config-reset-recovered.png'), (await window.webContents.capturePage()).toPNG());
      cases.push('无法解密时清空入口仍可用；确认后恢复三卡片，可重新填写、加密保存与读取');
      assert.equal(requests.length, 6);
      cases.push('清空与页面切换不触发内容提取或图片请求');

      await click('image', '使用 GLM 配置');
      await setField('image', 'imageApiKey', 'FIXTURE_GLM_SECRET'); await save('image');
      const glmStored = new LocalProviderService(dataDirectory, safeStorage).read();
      assert.equal(glmStored.imageProtocol, 'glm'); assert.equal(glmStored.imageModel, 'glm-image');
      assert.equal(glmStored.imageApiKey, 'FIXTURE_GLM_SECRET');
      assert.equal(glmStored.llmApiKey, 'FIXTURE_RECONFIGURED_SECRET');
      await navigate('二创工作台'); await openSettings();
      await waitFor('document.querySelectorAll("form[data-provider-module]").length===3');
      assert.equal(await js(field('image', 'imageProtocol') + '.value'), 'glm');
      assert.equal(await js(field('image', 'imageModel') + '.value'), 'glm-image');
      assert.equal(await js(field('image', 'imageApiKey') + '.value'), '');
      await js(form('image') + '.scrollIntoView({block:"start"})');
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(evidenceDirectory, 'glm-settings.png'), (await window.webContents.capturePage()).toPNG());
      assert.equal(await js('document.querySelectorAll("[name=glmService],[data-testid=glm-reference-service]").length'), 0);
      cases.push('GLM 仅保留文字生图配置，配置加密保存并重读，其他模块密钥保留且表单不回显密钥');

      const glmDraft = { ...structuredClone(draft), id: 'glm-provider-fixture', createdAt: '2026-11-02T12:00:00.000Z', title: 'GLM 图文验收' };
      const glmResult = await call('generateImageText', { draft: glmDraft, pageId: 'page-two', taskId: randomUUID() });
      assert.equal(glmResult.success, true, glmResult.error); assert.ok(glmResult.data.assetId);
      assert.equal(requests.length, 8);
      assert.equal(glmResult.data.draft.pages[0].assetId, undefined);
      assert.equal(glmResult.data.draft.pages[1].assetId, glmResult.data.assetId);
      assert.equal((await call('readImageTextAsset', glmResult.data.assetId)).success, true);
      cases.push('GLM 实际生成 IPC 下载 URL 图片并落盘，单页写入历史且不改变其他页');

      const legacyGLMDraft = structuredClone(glmResult.data.draft);
      legacyGLMDraft.references.push({ id: glmResult.data.assetId, name: 'legacy-glm-scene.png', kind: 'scene', width: 32, height: 32 });
      legacyGLMDraft.pages[1].referenceIds = [glmResult.data.assetId];
      assert.equal((await call('saveImageTextHistory', legacyGLMDraft)).success, true);
      await navigate('历史记录');
      await waitFor('document.querySelector("[data-record-id=glm-provider-fixture]")?.getAttribute("aria-pressed")==="true"');
      await clickPage('重新编辑');
      await waitFor('Boolean(document.querySelector("[aria-label=图文结果]"))');
      await js('{const el=document.querySelector("select[aria-label=选择图片]");el.value="page-two";el.dispatchEvent(new Event("change",{bubbles:true}));}');
      await waitFor('Boolean(document.querySelector("[aria-label=图文结果] img"))');
      await clickPage('图片优化'); await waitFor('Boolean(document.querySelector(".dialog-popup[role=dialog]"))');
      await js('{const el=Array.from(document.querySelectorAll(".dialog-popup[role=dialog] label")).find(el=>el.textContent.startsWith("本图文字")).querySelector("textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,"GLM 仅修改本图文字");el.dispatchEvent(new Event("input",{bubbles:true}));}');
      await waitFor('!document.querySelector(".dialog-popup[role=dialog] input[type=checkbox]").checked && document.querySelector(".dialog-popup[role=dialog] input[type=checkbox]").disabled');
      assert.equal(await js('Array.from(document.querySelectorAll(".dialog-popup[role=dialog] button")).find(el=>el.textContent.includes("为本图补传")).disabled'), true);
      await waitFor('Array.from(document.querySelectorAll(".dialog-popup[role=dialog] label")).some(el=>el.textContent.includes("legacy-glm-scene.png")&&el.querySelector("input[type=checkbox]")?.checked&&!el.querySelector("input[type=checkbox]")?.disabled)');
      await js('Array.from(document.querySelectorAll(".dialog-popup[role=dialog] label")).find(el=>el.textContent.includes("legacy-glm-scene.png")).querySelector("input[type=checkbox]").click()');
      await waitFor('Array.from(document.querySelectorAll(".dialog-popup[role=dialog] label")).some(el=>el.textContent.includes("legacy-glm-scene.png")&&!el.querySelector("input[type=checkbox]")?.checked&&el.querySelector("input[type=checkbox]")?.disabled)');
      assert.equal((await call('readImageTextAsset', glmResult.data.assetId)).success, true);
      assert.equal(requests.length, 8);
      assert.ok(await js('document.querySelector(".dialog-popup[role=dialog]").textContent.includes("参考图上传和上一版图片参考已关闭")'));
      await clickDialog('优化并重生成本图');
      await waitFor('!document.querySelector(".dialog-popup[role=dialog]")');
      await waitFor('window.electronAPI.listImageTextHistory().then(r=>r.data.find(d=>d.id==="glm-provider-fixture").versions.filter(v=>v.pageId==="page-two").length===2)');
      const optimizedGLM = (await call('listImageTextHistory')).data.find(d=>d.id==='glm-provider-fixture');
      assert.equal(requests.length, 10); assert.equal(optimizedGLM.pages[0].assetId, undefined);
      assert.notEqual(optimizedGLM.pages[1].assetId, glmResult.data.assetId);
      assert.equal((await call('readImageTextAsset', glmResult.data.assetId)).success, true);
      assert.equal(optimizedGLM.references.length, 1); assert.deepEqual(optimizedGLM.pages[1].referenceIds, []);
      cases.push('GLM 优化上传和上一版参考关闭，旧绑定可取消，文字生图保留素材、旧版本与其他页');
      const unsupportedGLM = await call('generateImageText', { draft: optimizedGLM, pageId: 'page-two', taskId: randomUUID(), usePreviousImage: true });
      assert.equal(unsupportedGLM.errorCode, 'IMAGE_PAGE_UNSUPPORTED'); assert.match(unsupportedGLM.error, /本页上一版图片/);
      assert.equal(requests.length, 10);
      const glmLogs = fs.readdirSync(path.join(dataDirectory, 'logs')).filter(file=>file.endsWith('.log')).map(file=>fs.readFileSync(path.join(dataDirectory, 'logs', file), 'utf8')).join('\n');
      assert.equal(glmLogs.includes('FIXTURE_GLM_SECRET'), false); assert.equal(glmLogs.includes('signature=fixture'), false);
      cases.push('GLM 不支持的上一版参考明确阻止且不发送请求，密钥和临时图片签名不写日志');
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(evidenceDirectory, 'glm-single-page.png'), (await window.webContents.capturePage()).toPNG());
      const glmUploadDraft = { ...structuredClone(draft), id: 'glm-upload-fixture', createdAt: new Date().toISOString(), confirmed: false, references: optimizedGLM.references };
      const savedGLMUpload = await call('saveImageTextHistory', glmUploadDraft);
      assert.equal(savedGLMUpload.success, true, savedGLMUpload.error);
      await navigate('历史记录');
      await waitFor('document.querySelector("[data-record-id=glm-upload-fixture]")?.getAttribute("aria-pressed")==="true"');
      await clickPage('重新编辑');
      await waitFor('Array.from(document.querySelectorAll("[role=tab]")).some(el=>el.textContent.trim()==="素材 1")');
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await js('{const el=Array.from(document.querySelectorAll("[role=tab]")).find(el=>el.textContent.trim()==="素材 1");el.focus();el.click();}');
      await waitFor('Array.from(document.querySelectorAll("[role=tab]")).some(el=>el.textContent.trim()==="素材 1"&&el.getAttribute("aria-selected")==="true")');
      for (const text of ['补传原帖参考图', '上传实际场景参考图（可选）']) {
        await waitFor('Array.from(document.querySelectorAll("button")).some(el=>el.textContent.trim()===' + JSON.stringify(text) + '&&el.disabled&&el.getClientRects().length>0)');
      }
      assert.equal(await js('document.body.innerText.includes("参考图上传已关闭")'), true);
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.equal(await js('Array.from(document.querySelectorAll("[role=tab]")).some(el=>el.textContent.trim()==="素材 1"&&el.getAttribute("aria-selected")==="true")'), true);
      await js('Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished))');
      // 隐藏窗口先触发绘制，再保存素材标签切换后的合成帧。
      await window.webContents.capturePage();
      await new Promise(resolve => setTimeout(resolve, 150));
      fs.writeFileSync(path.join(evidenceDirectory, 'glm-reference-disabled.png'), (await window.webContents.capturePage()).toPNG());
      cases.push('GLM 未确认稿件的风格与实景上传入口关闭，已有素材保留且可移除');

      const beforeMigration = new LocalProviderService(dataDirectory, safeStorage).read();
      const legacyConfig = { ...beforeMigration, imageProtocol: 'glm-sglang', imageEndpoint: 'http://localhost:30000/v1/images/generations', imageModel: 'zai-org/GLM-Image', imageApiKey: 'RETIRED_GLM_SECRET' };
      fs.writeFileSync(path.join(dataDirectory, 'providers.encrypted'), safeStorage.encryptString(JSON.stringify(legacyConfig)));
      const migrated = (await call('getProviderSettings')).config;
      assert.equal(migrated.imageProtocol, 'glm');
      assert.equal(migrated.imageEndpoint, 'https://open.bigmodel.cn/api/paas/v4/images/generations');
      assert.equal(migrated.imageModel, 'glm-image'); assert.equal(migrated.imageKeyConfigured, false);
      const afterMigration = new LocalProviderService(dataDirectory, safeStorage).read();
      assert.deepEqual(afterMigration, { ...beforeMigration, imageApiKey: undefined });
      assert.equal(fs.readFileSync(path.join(dataDirectory, 'providers.encrypted')).includes(Buffer.from('RETIRED_GLM_SECRET')), false);
      assert.equal((await call('readImageTextAsset', glmResult.data.assetId)).success, true);
      assert.equal(requests.length, 10);
      cases.push('旧图生图配置经系统安全存储迁移为官方文字预设，清除旧图片密钥，保留其他配置和素材且不发送请求');

      await openSettings();
      await waitFor('document.querySelectorAll("form[data-provider-module]").length===3');
      const beforeSub2API = (await call('getProviderSettings')).config;
      await click('image', '使用 Sub2API（异步生图） 配置');
      assert.equal(await js(field('image', 'imageProtocol') + '.value'), 'sub2api');
      assert.equal(await js(field('image', 'imageEndpoint') + '.value'), 'https://www.sevnx.lol/v1/images/generations');
      assert.equal(await js(field('image', 'imageModel') + '.value'), 'gpt-image-2');
      assert.equal(await js('Boolean(document.querySelector("[data-testid=sub2api-image-info]"))'), true);
      assert.equal(requests.length, 10); assert.deepEqual((await call('getProviderSettings')).config, beforeSub2API);
      await setField('image', 'imageApiKey', 'FIXTURE_SUB2API_SECRET'); await save('image');
      const sub2apiStored = new LocalProviderService(dataDirectory, safeStorage).read();
      assert.equal(sub2apiStored.imageProtocol, 'sub2api'); assert.equal(sub2apiStored.imageApiKey, 'FIXTURE_SUB2API_SECRET');
      assert.equal(sub2apiStored.llmApiKey, beforeMigration.llmApiKey); assert.equal(sub2apiStored.videoParserApiKey, beforeMigration.videoParserApiKey);
      assert.equal(fs.readFileSync(path.join(dataDirectory, 'providers.encrypted')).includes(Buffer.from('FIXTURE_SUB2API_SECRET')), false);
      await navigate('二创工作台'); await openSettings();
      await waitFor('document.querySelectorAll("form[data-provider-module]").length===3');
      assert.equal(await js(field('image', 'imageProtocol') + '.value'), 'sub2api');
      assert.equal(await js(field('image', 'imageApiKey') + '.value'), '');
      cases.push('Sub2API 预设填表不请求，配置加密保存、重读且不回显密钥，保留其他模块配置');
      await js(form('image') + '.scrollIntoView({block:"center",behavior:"instant"})');
      await js('Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished))');
      await window.webContents.capturePage();
      await new Promise(resolve => setTimeout(resolve, 150));
      fs.writeFileSync(path.join(evidenceDirectory, 'sub2api-settings.png'), (await window.webContents.capturePage()).toPNG());

      const subDraft = { ...structuredClone(draft), id: 'sub2api-provider-fixture', createdAt: new Date().toISOString(), title: 'Sub2API 异步验收' };
      const subGenerated = await call('generateImageText', { draft: subDraft, pageId: 'page-one', taskId: randomUUID() });
      assert.equal(subGenerated.success, true, subGenerated.error); assert.equal(requests.length, 14);
      assert.ok(subGenerated.data.assetId); assert.equal((await call('readImageTextAsset', subGenerated.data.assetId)).success, true);
      const subEditDraft = structuredClone(subGenerated.data.draft);
      subEditDraft.references = [{ id: subGenerated.data.assetId, name: 'sub2api-reference.png', kind: 'scene', width: 32, height: 32 }];
      subEditDraft.pages[0].referenceIds = [subGenerated.data.assetId]; subEditDraft.pages[0].text = '保留主体，修改标题';
      const subEdited = await call('generateImageText', { draft: subEditDraft, pageId: 'page-one', taskId: randomUUID(), usePreviousImage: true });
      assert.equal(subEdited.success, true, subEdited.error); assert.equal(requests.length, 18);
      assert.notEqual(subEdited.data.assetId, subGenerated.data.assetId);
      const editRequest = requests.find(item=>item.url==='https://www.sevnx.lol/v1/images/edits');
      assert.ok(editRequest.body.prompt.includes('保留主体，修改标题'));
      assert.equal((await call('readImageTextAsset', subGenerated.data.assetId)).success, true);
      assert.deepEqual(subEdited.data.draft.pages[1], subGenerated.data.draft.pages[1]);
      const subHistory = (await call('listImageTextHistory')).data.find(item=>item.id===subDraft.id);
      assert.equal(subHistory.pages[0].assetId, subEdited.data.assetId);
      const subLogs = fs.readdirSync(path.join(dataDirectory, 'logs')).filter(file=>file.endsWith('.log')).map(file=>fs.readFileSync(path.join(dataDirectory, 'logs', file), 'utf8')).join('\n');
      assert.equal(subLogs.includes('FIXTURE_SUB2API_SECRET'), false);
      cases.push('Sub2API 实际 IPC 异步文字生图，经 processing 与 completed 轮询后下载落盘并写入历史');
      cases.push('Sub2API 参考图和本页文字经 multipart 编辑，上一版图片去重，保留旧资产和其他页面');

      fs.writeFileSync(path.join(evidenceDirectory, 'acceptance.json'), JSON.stringify({ date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }), version: metadata.version, packaged: remotePackage, supplier: 'isolated fixtures', requests: requests.length, cases }, null, 2), 'utf8');
      console.log(JSON.stringify({ success: true, cases: cases.length, requests: requests.length, evidenceDirectory }));
      completed = true; clearTimeout(timer); app.quit();
    } catch (error) {
      console.error(error);
      fs.mkdirSync(evidenceDirectory, { recursive: true });
      fs.writeFileSync(path.join(evidenceDirectory, 'failure.png'), (await window.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(evidenceDirectory, 'failure.json'), JSON.stringify({ message: error.message, cases, ui: await js('({dialogs:Array.from(document.querySelectorAll(".dialog-popup[role=dialog]")).map(el=>({text:el.innerText,buttons:Array.from(el.querySelectorAll("button")).map(b=>b.textContent)})),nav:Array.from(document.querySelectorAll("nav button")).map(el=>el.getAttribute("aria-label"))})') }, null, 2), 'utf8');
      clearTimeout(timer); app.exit(1);
    }
  });
});
app.on('quit', () => { globalThis.fetch = originalFetch; testAuthServer?.close(); testAuthServer?.closeAllConnections(); if (!completed) process.exitCode = 1; });
async function start() {
  if (remotePackage) {
    // 仅验收进程将正式授权域名映射至临时服务；不改包内授权入口或配置。
    const { createAuthServer } = require(path.join(sourceRoot, 'dist-server/server/authServer.js'));
    testAuthServer = await createAuthServer({ dataDirectory: path.join(dataDirectory, 'auth-fixture'), adminPassword: password });
    await new Promise(resolve => testAuthServer.listen(0, '127.0.0.1', resolve));
    authOrigin = new URL(JSON.parse(fs.readFileSync(path.join(applicationPath, 'dist-electron/auth-config.json'), 'utf8')).url).origin;
    fs.writeFileSync(path.join(dataDirectory, 'auth-server-binding.json'), JSON.stringify({ version: 1, url: authOrigin }));
    fixtureAuthOrigin = 'http://127.0.0.1:' + testAuthServer.address().port;
  }
  require(path.join(applicationPath, 'dist-electron', 'main.js'));
}
start().catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
