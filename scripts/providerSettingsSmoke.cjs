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
const evidenceDirectory = remotePackage ? path.join(sourceRoot, 'release', 'provider-settings-' + metadata.version)
  : path.join(sourceRoot, 'docs', '图文流程排查证据', '2026-10-30-设置与历史优化');
app.setPath('userData', dataDirectory);
const png = nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4, 255), { width: 32, height: 32 }).toPNG().toString('base64');
const requests = [];
let imageStatus = 200;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const address = new URL(url);
  if (remotePackage && address.origin === authOrigin) return originalFetch(fixtureAuthOrigin + address.pathname + address.search, init);
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const headers = new Headers(init?.headers);
  const request = { url, body, key: headers.get('Authorization') };
  requests.push(request);
  if (url === 'https://api.deepseek.com/chat/completions') {
    return Response.json({ id: 'fixture', object: 'chat.completion', created: 0, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: '连接成功' }, finish_reason: 'stop' }] });
  }
  if (url === 'https://linkdigest.dev/api/v1/digest') {
    return Response.json({ platform: 'xiaohongshu', title: '提取测试', caption: '原帖文字', transcript: [],
      images: [{ ocr: '图片文字', description: '自然光场景' }], coverage: { images_read: 1, images_total: 1 } });
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
    const js = expression => window.webContents.executeJavaScript(expression);
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
      const navigate = label => js('document.querySelector("nav button[aria-label=' + label + ']").click()');
      const clickPage = text => js('Array.from(document.querySelectorAll("button")).find(el=>el.textContent.trim()===' + JSON.stringify(text) + ').click()');
      const clickDialog = text => js('Array.from(document.querySelector("[role=dialog]").querySelectorAll("button")).find(el=>el.textContent.trim()===' + JSON.stringify(text) + ').click()');
      const newestVideo = { id: 'latest-video-fixture', title: '最新视频验收', createdAt: '2026-10-30T08:00:00.000Z', platform: 'douyin',
        sourceUrl: 'https://v.douyin.com/fixture', durationSec: 18, userCameraWork: '', originalTranscript: '视频原稿', visualSummary: '',
        rawGeneratedScript: '最新视频内容', parsedStructure: {}, refinementHistory: [], conversationMessages: [] };
      assert.equal((await call('saveHistoryToDB', newestVideo)).success, true);
      await navigate('历史记录');
      await waitFor('document.querySelector("[data-record-id=latest-video-fixture]")?.getAttribute("aria-pressed")==="true" && document.querySelector("[aria-label=历史详情] h2")?.textContent==="最新视频验收"');
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

      const openSettings = async () => {
        await navigate('设置');
        await js('Array.from(document.querySelectorAll("[role=tab]")).find(el=>el.textContent.trim()==="系统设置").click()');
      };
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

      fs.writeFileSync(path.join(evidenceDirectory, 'acceptance.json'), JSON.stringify({ date: '2026-10-30', version: metadata.version, packaged: remotePackage, supplier: 'isolated fixtures', requests: requests.length, cases }, null, 2), 'utf8');
      console.log(JSON.stringify({ success: true, cases: cases.length, requests: requests.length, evidenceDirectory }));
      completed = true; clearTimeout(timer); app.quit();
    } catch (error) {
      console.error(error);
      fs.mkdirSync(evidenceDirectory, { recursive: true });
      fs.writeFileSync(path.join(evidenceDirectory, 'failure.png'), (await window.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(evidenceDirectory, 'failure.json'), JSON.stringify({ message: error.message, cases }, null, 2), 'utf8');
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
    fixtureAuthOrigin = 'http://127.0.0.1:' + testAuthServer.address().port;
  }
  require(path.join(applicationPath, 'dist-electron', 'main.js'));
}
start().catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
