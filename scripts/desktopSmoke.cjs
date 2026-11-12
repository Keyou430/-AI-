const { app, shell, dialog, nativeImage } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-remix-smoke-'));
app.setPath('userData', dataDirectory);
const applicationPath = path.resolve(process.argv[2] || '.');
const password = 'Test-' + randomUUID();
const remotePackage = require(path.join(applicationPath, 'package.json')).authMode === 'remote';
let testAuthServer;
const originalFetch = globalThis.fetch;
async function preparePackagedAuth() {
  if (!remotePackage) return;
  // 仅验收进程将授权请求交给隔离服务，正式 ASAR 和授权配置保持原样。
  const { createAuthServer } = require('../dist-server/server/authServer.js');
  testAuthServer = await createAuthServer({ dataDirectory: path.join(dataDirectory, 'auth-fixture'), adminPassword: password });
  await new Promise(resolve => testAuthServer.listen(0, '127.0.0.1', resolve));
  const config = JSON.parse(fs.readFileSync(path.join(applicationPath, 'dist-electron/auth-config.json'), 'utf8'));
  const origin = new URL(config.binding === 'installation' ? 'https://auth.smoke.test' : config.url).origin;
  fs.writeFileSync(path.join(dataDirectory, 'auth-server-binding.json'), JSON.stringify({ version: 1, url: origin }));
  const fixtureOrigin = 'http://127.0.0.1:' + testAuthServer.address().port;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === origin) return originalFetch(fixtureOrigin + url.pathname + url.search, init);
    return originalFetch(input, init);
  };
}
const logDirectory = path.join(dataDirectory, 'logs');
const readLogs = () => fs.readdirSync(logDirectory).filter(name => name.endsWith('.log')).flatMap(name =>
  fs.readFileSync(path.join(logDirectory,name),'utf8').trim().split('\n').map(line => JSON.parse(line)));
let completed = false;
const timer = setTimeout(() => { console.error('桌面验证超时'); app.exit(1); }, 120000);
const waitFor = async (window, expression) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const ready = await window.webContents.executeJavaScript(expression).catch(error => { throw new Error('等待界面脚本异常：' + expression, { cause: error }); });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('界面未达到预期状态：' + expression);
};

app.on('browser-window-created', (_event, window) => {
  window.show = () => {};
  const execute = window.webContents.executeJavaScript.bind(window.webContents);
  window.webContents.executeJavaScript = (expression, ...args) => execute(expression, ...args).catch(error => {
    throw new Error('桌面验收脚本失败：' + expression.slice(0, 240), { cause: error });
  });
  window.webContents.once('did-finish-load', async () => {
    try {
      const call = (method, payload) => window.webContents.executeJavaScript(
        'window.electronAPI[' + JSON.stringify(method) + '](' + (payload === undefined ? '' : JSON.stringify(payload)) + ')');
      await waitFor(window, remotePackage ? "Boolean(document.querySelector('[name=username]'))" : "document.body.innerText.includes('初始化管理员')");
      assert.ok(readLogs().some(entry => entry.event === 'app.start'));
      assert.ok(readLogs().some(entry => entry.event === 'database.ready'));
      assert.equal((await call('openLogFolder')).errorCode,'AUTH_REQUIRED');
      // 实际触发前端 Error 和 Promise rejection，确认登录前也能留痕且不记录消息正文。
      await window.webContents.executeJavaScript('setTimeout(() => { throw new Error("LOG_PRIVATE_RENDERER_ERROR"); }, 0); setTimeout(() => { Promise.reject(new Error("LOG_PRIVATE_RENDERER_REJECTION")); }, 0); true;');
      await waitFor(window, 'window.electronAPI.getAuthStatus().then(() => true)');
      assert.equal((await call('parseVideo',{rawInput:'https://v.douyin.com/demo/',enableMockFallback:true})).errorCode,'AUTH_REQUIRED');
      assert.equal((await call('fetchHotspots')).errorCode,'AUTH_REQUIRED');
      // 通过实际首屏表单完成管理员初始化或远程登录。
      await window.webContents.executeJavaScript(
        (remotePackage ? 'document.querySelector("[name=username]").value="admin";' : 'document.querySelector("[name=displayName]").value="测试管理员";') +
        'document.querySelector("[name=password]").value=' + JSON.stringify(password) + ';' +
        'document.querySelector("form").requestSubmit();');
      await waitFor(window, 'Boolean(document.querySelector("nav button[aria-label=账号管理]"))');
      assert.equal((await call('listHistoryFromDB')).records.length, 0);
      // 测试响应仅由验收脚本的本地 HTTP/SSE 服务提供，产品只走真实请求。
      const imagePlanningInputs = [];
      const providerServer = http.createServer(async (request, response) => {
        if (request.url === '/image-digest') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ platform: 'xiaohongshu', title: '图文验收', author: '测试作者',
            caption: '图文验收正文 #新能源[话题]#', transcript: [], duration_seconds: null,
            images: [{ ocr: '图文验收图片原文', description: '智能描述' }], tags: ['新能源', '外贸'],
            key_points: ['智能分析要点'], coverage: { images_read: 1, images_total: 1 }, credits: 0 }));
          return;
        }
        if (request.url === '/parse') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ data: { title: '接口验收素材', transcript: '接口验收原始口播', duration: 18 } }));
          return;
        }
        let body = ''; for await (const chunk of request) body += chunk;
        const messages = JSON.parse(body).messages;
        const prompt = messages.at(-1).content;
        if (messages[0].content.includes('小红书图文策划师')) {
          const input = JSON.parse(prompt);
          const current = input.current;
          assert.ok(input.remixContext);
          assert.match(messages[0].content, /无论素材来自小红书链接、人工指定图文还是热点转入/);
          assert.match(messages[0].content, /共同机制→行业标签→用户价值/);
          imagePlanningInputs.push(input.remixContext);
          const pages = current.pages.length ? current.pages : [
            { id: '', text: '图文封面', visual: '自然光实景封面', referenceIds: [] },
            { id: '', text: '方法介绍', visual: '实景细节', referenceIds: [] },
          ];
          if (input.instruction.includes('优化第二页')) pages[1].text = '优化后的方法介绍';
          const plan = { title: '图文验收二创', body: current.body || '二创发布正文', tags: ['收纳'], style: current.style || '自然光实景', notices: ['行业关联：原帖出行场景→高峰规划→新能源汽车→返程更有准备→出行科普；属于场景类比，不代表事件使用过本公司产品。'], pages };
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(plan) } }] }) + '\n\ndata: [DONE]\n\n');
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const script = '【分镜脚本总览】共2个镜头，总时长18秒\n【镜头1 | 0-9秒】\n▪️人员动作分工：出镜人员展示产品，摄影师跟拍\n▪️运镜与拍摄执行标准：近景平视\n▪️声音内容：接口生成验收\n【镜头2 | 9-18秒】\n▪️人员动作分工：展示产品细节\n▪️运镜与拍摄执行标准：特写平移\n▪️声音内容：第二镜验收\n' + prompt;
        const pieces = script.match(/[\s\S]{1,80}/g);
        let index = 0;
        const interval = setInterval(() => {
          if (index === pieces.length) { clearInterval(interval); response.end('data: [DONE]\n\n'); return; }
          response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: pieces[index++] } }] }) + '\n\n');
        }, 35);
        response.on('close', () => clearInterval(interval));
      });
      await new Promise(resolve => providerServer.listen(0, '127.0.0.1', resolve));
      const baseURL = 'http://127.0.0.1:' + providerServer.address().port;
      const { LocalProviderService } = require(path.join(applicationPath, 'dist-electron', 'services', 'localProviderService.js'));
      const originalRead = LocalProviderService.prototype.read;
      LocalProviderService.prototype.read = function () { return { ...originalRead.call(this),
        llmApiKey: 'fixture-key', llmBaseUrl: baseURL, llmModel: 'fixture-model', videoParserApiKey: 'fixture-key', videoParserEndpoint: baseURL + '/parse' }; };
      // 旧持久化配置启用仿真也不能恢复入口或返回示例数据。
      await window.webContents.executeJavaScript('localStorage.setItem("video-remix-ai-full-v3-storage", JSON.stringify({version:1,state:{settings:{enableMockFallback:true}}}))');
      const fixtureIndustry = { primaryIndustry: '新能源 / 智能出行与绿色能源', subCategories: ['新能源汽车', '续航', '补能规划'], targetAudience: '电动车主', corePainPoints: ['排队补能'], suggestedAngles: ['返程规划'], lastUpdated: Date.now(), isAutoDetected: false };
      await window.webContents.executeJavaScript('localStorage.setItem("video-remix-trending-v1", ' + JSON.stringify(JSON.stringify({ state: { profile: fixtureIndustry }, version: 0 })) + ')');
      const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
      window.webContents.reload(); await reloaded;
      await waitFor(window, 'Boolean(document.querySelector("nav button[aria-label=设置]"))');
      await window.webContents.executeJavaScript('document.querySelector("nav button[aria-label=设置]").click()');
      await waitFor(window, 'Boolean(document.querySelector("[aria-label=设置分类]"))');
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[aria-label=设置分类] [role=tab]")).find(el => el.textContent === "系统设置").click()');
      assert.equal(await window.webContents.executeJavaScript('document.body.innerText.includes("启用仿真模式")'), false);
      assert.equal(await window.webContents.executeJavaScript('"enableMockFallback" in JSON.parse(localStorage.getItem("video-remix-ai-full-v3-storage")).state.settings'), false);
      await window.webContents.executeJavaScript('document.querySelector("nav button[aria-label=二创工作台]").click()');
      // 新工作台不预填演示素材；显式输入后才提取。
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-testid=editable-transcript]").value'), '');
      assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector("[data-testid=script-empty]"))'), true);
      await window.webContents.executeJavaScript('{ const input = document.querySelector("[name=sourceVideoUrl]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"https://v.douyin.com/demo/"); input.dispatchEvent(new Event("input",{bubbles:true})); }');
      // 提取不自动二创，人工修改后才生成；原稿和修改稿分别保存。
      const beforeExtract = (await call('listHistoryFromDB')).records.length;
      await window.webContents.executeJavaScript('document.querySelector("[data-testid=extract-video]").click()');
      await waitFor(window, 'document.querySelector("[data-testid=editable-transcript]")?.value === "接口验收原始口播"');
      assert.equal((await call('listHistoryFromDB')).records.length,beforeExtract);
      await window.webContents.executeJavaScript('const textarea = document.querySelector("[data-testid=editable-transcript]"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(textarea,"人工修订后的企业口播"); textarea.dispatchEvent(new Event("input",{bubbles:true}));');
      await waitFor(window, "document.querySelector('[aria-label=素材编辑]').innerText.includes('已编辑')");
      await window.webContents.executeJavaScript('document.querySelector("[data-testid=generate-script]").click()');
      await waitFor(window, 'window.electronAPI.listHistoryFromDB().then(result => result.records.some(record => record.originalTranscript === "人工修订后的企业口播"))');
      const manualRecord = (await call('listHistoryFromDB')).records.find(record => record.originalTranscript === '人工修订后的企业口播');
      assert.ok(manualRecord.conversationMessages[0].content.includes('人工修订后的企业口播'));
      assert.ok(manualRecord.sourceContent.transcript); assert.notEqual(manualRecord.sourceContent.transcript,manualRecord.originalTranscript);
      await require(path.join(__dirname, "scriptParsingSmoke.cjs"))({ window, call, waitFor, manualRecord });
      // 通过真实界面在 A 的迭代期间打开 B，确认旧请求不会覆盖 B。
      const otherRecord = {...manualRecord,id:'smoke-race-b',title:'切换记录B',
        originalTranscript:'记录B独立口播',rawGeneratedScript:'记录B独立脚本',
        refinementHistory:[],conversationMessages:[]};
      assert.equal((await call('saveHistoryToDB',otherRecord)).success,true);
      const refine = async (instruction) => {
        await window.webContents.executeJavaScript('document.querySelector("[data-testid=optimize-script]").click()');
        await waitFor(window, 'Boolean(document.querySelector("#optimize-form textarea"))');
        await window.webContents.executeJavaScript(
          '{ const textarea = document.querySelector("#optimize-form textarea");' +
          'Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(textarea,' + JSON.stringify(instruction) + ');' +
          'textarea.dispatchEvent(new Event("input",{bubbles:true})); }');
        await waitFor(window, '!document.querySelector("button[form=optimize-form]").disabled');
        await window.webContents.executeJavaScript('document.querySelector("#optimize-form").requestSubmit()');
        await waitFor(window, 'document.querySelector("[data-testid=generate-script]")?.textContent.includes("生成中")');
      };
      await refine('强化原记录A的产品卖点');
      await window.webContents.executeJavaScript('document.querySelector("nav button[aria-label=历史记录]").click()');
      await waitFor(window, 'document.body.innerText.includes("切换记录B")');
      await window.webContents.executeJavaScript('document.querySelector("[data-record-id=smoke-race-b]").click()');
      await waitFor(window, 'document.querySelector("[aria-label=历史详情] h2")?.textContent === "切换记录B"');
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(el => el.textContent.includes("重新编辑")).click()');
      await waitFor(window, 'document.querySelector("textarea")?.value === "记录B独立口播"');
      await waitFor(window, 'Boolean(document.querySelector("[data-testid=extract-video]:not(:disabled)"))');
      const afterRefine = (await call('listHistoryFromDB')).records;
      assert.equal(afterRefine.find(record => record.id === otherRecord.id).rawGeneratedScript,otherRecord.rawGeneratedScript);
      assert.equal(afterRefine.find(record => record.id === manualRecord.id).refinementHistory.length,manualRecord.refinementHistory.length + 1);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("textarea").value'),otherRecord.originalTranscript);
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[role=tab]")).find(el => el.textContent.trim() === "全文").click()');
      await waitFor(window, 'document.querySelector("[role=tabpanel] pre")?.textContent === "记录B独立脚本"');
      // 模拟数据库写入失败，确认界面保留生成结果、显示失败原因并解除忙碌状态。
      const { LocalSQLiteManager } = require(path.join(applicationPath,'dist-electron','db','sqliteService.js'));
      const originalUpsert = LocalSQLiteManager.prototype.upsertRecord;
      LocalSQLiteManager.prototype.upsertRecord = async function (record) {
        if (record.id === otherRecord.id) throw new Error('测试磁盘空间不足');
        return originalUpsert.call(this,record);
      };
      try {
        await refine('验证保存失败时保留生成结果');
        await waitFor(window, 'document.body.innerText.includes("脚本已生成，但保存历史失败：测试磁盘空间不足")');
        await waitFor(window, 'Boolean(document.querySelector("[data-testid=extract-video]:not(:disabled)"))');
        assert.equal((await call('listHistoryFromDB')).records.find(record => record.id === otherRecord.id).rawGeneratedScript,otherRecord.rawGeneratedScript);
        await waitFor(window, 'document.querySelector("[role=tabpanel] pre")?.textContent.includes("验证保存失败时保留生成结果")');
      } finally { LocalSQLiteManager.prototype.upsertRecord = originalUpsert; }
      // 图文通过正式提取／策划／生图适配器；仅在隔离验收进程替换供应商响应，不调用商业接口。
      const beforeImageFetch = globalThis.fetch;
      const beforeDialog = dialog.showOpenDialog;
      const samplePNG = nativeImage.createFromBitmap(Buffer.alloc(48 * 64 * 4, 220), { width: 48, height: 64 }).toPNG();
      const referenceFile = path.join(dataDirectory, 'scene.png'); fs.writeFileSync(referenceFile, samplePNG);
      let imageCalls = 0; const imageRequests = []; let pendingImageResponse = null;
      LocalProviderService.prototype.read = function () { return { ...originalRead.call(this),
        llmApiKey: 'fixture-key', llmBaseUrl: baseURL, llmModel: 'fixture-model', agnesApiKey: 'fixture-key',
        videoParserProvider: 'linkdigest', videoParserApiKey: 'fixture-key', linkDigestMaxCredits: 5 }; };
      globalThis.fetch = (input, init) => {
        if (String(input) === 'https://linkdigest.dev/api/v1/digest') return beforeImageFetch(baseURL + '/image-digest', init);
        if (String(input) === 'https://apihub.agnes-ai.com/v1/images/generations') {
          imageCalls++; const payload = JSON.parse(init.body); imageRequests.push(payload);
          const [rw, rh] = payload.ratio.split(':').map(Number);
          const width = rw * 16, height = rh * 16;
          const bitmap = Buffer.alloc(width * height * 4);
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4; const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
            bitmap[offset] = edge ? 95 : y < height / 2 ? 235 : 190;
            bitmap[offset + 1] = edge ? 65 : y < height / 2 ? 210 : 225;
            bitmap[offset + 2] = edge ? 60 : y < height / 2 ? 185 : 220;
            bitmap[offset + 3] = 255;
          }
          const output = nativeImage.createFromBitmap(bitmap, { width, height }).toPNG();
          return (pendingImageResponse || Promise.resolve()).then(() => Response.json({ data: [{ b64_json: output.toString('base64') }] }));
        }
        return beforeImageFetch(input, init);
      };
      const clickText = async text => {
        const expression = 'Array.from(document.querySelectorAll("button")).find(el => el.textContent.trim() === ' + JSON.stringify(text) + ')';
        await waitFor(window, 'Boolean(' + expression + ')');
        return window.webContents.executeJavaScript(expression + '.click()').catch(error => { throw new Error('点击按钮失败：' + text, { cause: error }); });
      };
      const setLabel = (label, value) => window.webContents.executeJavaScript('(' + ((name, next) => {
        const labels = Array.from(document.querySelectorAll('label')).filter(el => el.firstChild?.textContent === name);
        const labelElement = labels.find(el => el.closest('[role=dialog]')) || labels[0];
        const el = labelElement?.querySelector('textarea,input,select');
        if (!el) throw new Error('找不到可编辑字段');
        Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, next);
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      }).toString() + ')(' + JSON.stringify(label) + ',' + JSON.stringify(value) + ')').catch(error => { throw new Error('填写字段失败：' + label, { cause: error }); });
      const insertPage = async direction => {
        await clickText('增加一图');
        await waitFor(window, 'Array.from(document.querySelectorAll("[role=menuitem]")).some(el => el.textContent.trim() === ' + JSON.stringify(direction) + ')');
        await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[role=menuitem]")).find(el => el.textContent.trim() === ' + JSON.stringify(direction) + ').click()');
      };
      const imageHistory = async () => (await call('listImageTextHistory')).data;
      const layoutDirectory = process.env.REMIX_SMOKE_OUTPUT || (applicationPath.endsWith('.asar') ? path.join(__dirname, '..', 'release', 'three-module-layout-' + require(path.join(applicationPath, 'package.json')).version) : path.join(applicationPath, 'docs', '图文流程排查证据', '2026-11-02-删除跳转-三模块布局'));
      fs.mkdirSync(layoutDirectory, { recursive: true });
      const layoutChecks = [];
      const layoutEval = (fn, ...args) => window.webContents.executeJavaScript('(' + fn.toString() + ')(' + args.map(value => JSON.stringify(value)).join(',') + ')').catch(error => { throw new Error('布局脚本失败：' + fn.toString(), { cause: error }); });
      const layoutRecord = (id, details) => {
        layoutChecks.push({ id, status: 'PASS', details });
        fs.writeFileSync(path.join(layoutDirectory, 'layout.json'), JSON.stringify({ date: '2026-11-02', version: require(path.join(applicationPath, 'package.json')).version, packaged: applicationPath.endsWith('.asar'), supplier: 'isolated fixtures', cases: layoutChecks }, null, 2), 'utf8');
      };
      const captureLayout = async name => {
        await layoutEval(() => document.querySelectorAll("button[aria-label=关闭提示]").forEach(el => el.click()));
        await waitFor(window, '!document.querySelector("button[aria-label=关闭提示]")');
        window.setOpacity(0); window.showInactive();
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
        await new Promise(resolve => setTimeout(resolve, 160));
        fs.writeFileSync(path.join(layoutDirectory, name + '.png'), (await window.webContents.capturePage()).toPNG());
      };
      const resizeLayout = async (width, height) => {
        window.setOpacity(0); window.showInactive();
        window.setContentSize(width, height);
        await waitFor(window, 'window.innerWidth === ' + width + ' && window.innerHeight === ' + height);
        await new Promise(resolve => setTimeout(resolve, 180)); // 侧栏宽度有 150ms CSS 过渡，尺寸稳定后再测量。

      };
      const selectLayoutTab = async prefix => {
        await layoutEval(value => { const el = Array.from(document.querySelectorAll('[aria-label=图文编辑分页] [role=tab]')).find(el => el.textContent.trim().startsWith(value)); el.click(); }, prefix);
        await waitFor(window, 'Array.from(document.querySelectorAll("[aria-label=图文编辑分页] [role=tab]")).some(el => el.textContent.trim().startsWith(' + JSON.stringify(prefix) + ') && el.getAttribute("aria-selected") === "true") && Array.from(document.querySelectorAll("#image-text-plan [role=tabpanel]")).filter(el => !el.hidden).length === 1');
      };
      const readLayoutLabel = label => layoutEval(value => Array.from(document.querySelectorAll('[aria-label=图文策划与确认] label')).find(el => el.firstChild?.textContent === value)?.querySelector('textarea,input,select')?.value, label);
      const measureLayout = () => layoutEval(() => {
        const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, visible: r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 }; };
        const button = text => Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim().startsWith(text));
        const field = text => Array.from(document.querySelectorAll('[aria-label=图文策划与确认] label')).find(el => el.firstChild?.textContent === text)?.querySelector('textarea');
        return { width: innerWidth, height: innerHeight, scrollHeight: document.scrollingElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth, confirm: rect(button('确认文案、张数及比例')), pagination: rect(document.querySelector('[aria-label=图片分页]')), preview: rect(document.querySelector('[data-testid=image-text-preview]')), previous: rect(button('上一图')), next: rect(button('下一图')), text: rect(field('图片内文字')), visual: rect(field('画面要求')), retry: rect(button('继续／重试')), cancel: rect(button('取消任务')), progress: rect(document.querySelector('header [role=status]')), selectedTab: document.querySelector('[aria-label=图文编辑分页] [role=tab][aria-selected=true]')?.textContent.trim() };
      });
      const panelProportion = (panel, scroll) => layoutEval((p, s) => { const a = document.querySelector(p).getBoundingClientRect(); const b = document.querySelector(s).getBoundingClientRect(); return { panelHeight: a.height, scrollHeight: b.height, proportion: b.height / a.height, widthProportion: a.width / innerWidth }; }, panel, scroll);
      const assertPagination = bounds => {
        assert.ok(bounds.pagination?.visible && bounds.pagination.y >= bounds.preview.bottom && bounds.pagination.y - bounds.preview.bottom <= 16, JSON.stringify(bounds));
      };
      const assertImageProportion = async () => { const ratio = await panelProportion('[aria-label=图文策划与确认]', '[data-testid=image-text-plan-scroll]'); assert.ok(ratio.proportion >= .65, JSON.stringify(ratio)); return ratio; };
      window.webContents.setBackgroundThrottling(false);
      try {
        // 三模块几何尺寸、视频工具栏和导出菜单通过真实组件验收。
        await layoutEval(() => Array.from(document.querySelectorAll('[aria-label=脚本视图] [role=tab]')).find(el => el.textContent === '拍摄脚本').click());
        await waitFor(window, 'Boolean(document.querySelector("[aria-label=下一个镜头]"))');
        for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]]) {
          await resizeLayout(width, height);
          const ratio = await panelProportion('[aria-label=脚本结果]', '[data-testid=script-result-scroll]');
          assert.ok(ratio.proportion >= .8, JSON.stringify(ratio));
          layoutRecord('R5-workbench-' + width, ratio); await captureLayout('工作台-' + width + 'x' + height);
        }
        await resizeLayout(1366, 768);
        await layoutEval(() => Array.from(document.querySelectorAll('[aria-label=脚本视图] [role=tab]')).find(el => el.textContent === '拍摄脚本').click());
        await waitFor(window, 'Boolean(document.querySelector("[aria-label=下一个镜头]"))');
        await layoutEval(() => document.querySelector('[aria-label=下一个镜头]').click());
        assert.equal(await layoutEval(() => document.querySelector('[aria-label=选择镜头]').value), '1');
        await layoutEval(() => document.querySelector('[aria-label=上一个镜头]').click());
        assert.equal(await layoutEval(() => document.querySelector('[aria-label=选择镜头]').value), '0');
        for (const tab of ['拍摄手法', '口播稿', '全文']) {
          await layoutEval(value => Array.from(document.querySelectorAll('[aria-label=脚本视图] [role=tab]')).find(el => el.textContent === value).click(), tab);
          await waitFor(window, 'document.querySelector("[aria-label=脚本视图] [aria-selected=true]")?.textContent === ' + JSON.stringify(tab));
        }
        // 剪贴板使用隔离接收器，避免覆盖操作系统中用户已有的内容。
        await layoutEval(() => { window.layoutClipboardWrite = navigator.clipboard.writeText; navigator.clipboard.writeText = async text => { window.layoutCopiedText = text; }; document.querySelector('[aria-label=复制全文]').click(); });
        await waitFor(window, 'document.querySelector("[aria-label=复制全文]").textContent.includes("已复制")');
        assert.ok(await layoutEval(() => window.layoutCopiedText.includes('验证保存失败时保留生成结果')));
        await layoutEval(() => { navigator.clipboard.writeText = window.layoutClipboardWrite; delete window.layoutClipboardWrite; delete window.layoutCopiedText; });
        await layoutEval(() => document.querySelector('nav button[aria-label=历史记录]').click());
        await waitFor(window, 'Boolean(document.querySelector("[data-record-id=' + manualRecord.id + ']"))');
        await layoutEval(id => document.querySelector('[data-record-id="' + id + '"]').click(), manualRecord.id);
        await waitFor(window, 'Boolean(document.querySelector("[aria-label=历史详情] [data-testid=script-result-scroll]"))');
        for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]]) {
          await resizeLayout(width, height);
          const ratio = await panelProportion('[aria-label=历史详情]', '[data-testid=script-result-scroll]');
          assert.ok(ratio.proportion >= .8 && ratio.widthProportion > .5, JSON.stringify(ratio));
          layoutRecord('R5-history-video-' + width, ratio); await captureLayout('历史脚本-' + width + 'x' + height);
        }
        const savedDialog = dialog.showSaveDialog;
        try {
          for (const [label, ext] of [['导出文本', 'txt'], ['导出文档', 'doc']]) {
            const outputFile = path.join(dataDirectory, 'layout-export.' + ext);
            dialog.showSaveDialog = async () => ({ canceled: false, filePath: outputFile });
            await clickText('导出'); await waitFor(window, 'Boolean(document.querySelector("[role=menuitem]"))');
            await layoutEval(value => Array.from(document.querySelectorAll('[role=menuitem]')).find(el => el.textContent === value).click(), label);
            await waitFor(window, 'document.body.innerText.includes(' + JSON.stringify('已导出：' + manualRecord.title.slice(0,20) + '_二创分镜脚本.' + ext) + ')');
            assert.ok(fs.readFileSync(outputFile, 'utf8').includes('接口生成验收'));
          }
        } finally { dialog.showSaveDialog = savedDialog; }
        layoutRecord('R4-video-tools', { tabs: true, shotPagination: true, copy: true, txt: true, doc: true });
        await layoutEval(() => document.querySelector('nav button[aria-label=小红书图文]').click());
        await waitFor(window, 'Boolean(document.querySelector("[data-testid=image-text-empty]"))');
        for (const [width, height] of [[1366, 768], [1920, 1080], [390, 844]]) {
          await resizeLayout(width, height);
          const blank = await layoutEval(() => ({ panels: ['图文策划与确认', '图文结果'].every(label => !!document.querySelector('[aria-label="' + label + '"]')), disabledTabs: Array.from(document.querySelectorAll('[aria-label=图文编辑分页] [role=tab]')).every(el => el.disabled), noConfirm: !Array.from(document.querySelectorAll('button')).some(el => el.textContent.startsWith('确认文案、张数及比例')), noPagination: !document.querySelector('[aria-label=图片分页]'), linkEnabled: !document.querySelector('#image-text-link').disabled, noOverflow: document.documentElement.scrollWidth <= innerWidth }));
          assert.ok(Object.values(blank).every(Boolean), JSON.stringify(blank)); layoutRecord('R2-blank-' + width, blank); await captureLayout('图文空白-' + width + 'x' + height);
        }
        await resizeLayout(1366, 768);
        await layoutEval(() => document.querySelector('nav button[aria-label=二创工作台]').click());
        await window.webContents.executeJavaScript('{ const input = document.querySelector("[name=sourceVideoUrl]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"https://www.xiaohongshu.com/explore/image-note"); input.dispatchEvent(new Event("input",{bubbles:true})); }');
        await window.webContents.executeJavaScript('document.querySelector("[data-testid=extract-video]").click()');
        await waitFor(window, 'document.body.innerText.includes("确认文案、张数及比例，开始生成 2 张图片") && !document.body.innerText.includes("正在融合知识库")');
        assert.equal(imageCalls, 0);
        assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector("[aria-label=图文结果]"))'), true);
        assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-testid=source-keywords]").textContent.includes("外贸")'), true);
        const initialDraft = (await imageHistory())[0];
        assert.equal(initialDraft.source.sourceHotspot, undefined);
        assert.deepEqual(initialDraft.remixContext.industryProfile, fixtureIndustry);
        assert.equal(initialDraft.remixContext.companyBusinessProfile, '');
        assert.deepEqual(imagePlanningInputs[0].industryProfile, fixtureIndustry);
        assert.equal(await layoutEval(() => document.querySelector('[data-testid=image-text-industry-context]').textContent.includes('新能源 / 智能出行与绿色能源')), true);
        assert.equal(await layoutEval(() => document.querySelector('[data-testid=image-text-plan-notices]').textContent.includes('行业关联：')), true);
        const noticesLayout = await layoutEval(() => {
          const section = document.querySelector('[data-testid=image-text-plan-scroll]');
          const notices = section.querySelector('[data-testid=image-text-plan-notices]');
          const collapsedByDefault = !notices.open;
          const atBottom = section.lastElementChild === notices;
          notices.querySelector('summary').click();
          const expandsWithContent = notices.open && notices.innerText.includes('行业关联：');
          notices.querySelector('summary').click();
          return { collapsedByDefault, atBottom, expandsWithContent, collapsesOnClick: !notices.open };
        });
        assert.ok(Object.values(noticesLayout).every(Boolean), JSON.stringify(noticesLayout));
        layoutRecord('plan-notices-bottom-collapsed', noticesLayout);
        await layoutEval(() => { const section = document.querySelector('[data-testid=image-text-plan-scroll]'); section.scrollTop = section.scrollHeight; });
        await captureLayout('策划说明-底部默认收起');
        await layoutEval(() => { document.querySelector('[data-testid=image-text-plan-scroll]').scrollTop = 0; });
        layoutRecord('industry-remix-direct-note', { ordinaryNoteUsesIndustryContext: true, connectionRuleInModelRequest: true, industryAndBasisVisible: true, noImagesBeforeConfirmation: imageCalls === 0 });
        assert.equal((await call('generateImageText', { draft: initialDraft, pageId: initialDraft.pages[0].id, taskId: randomUUID() })).success, false);
        assert.equal(imageCalls, 0);
        // 布局验收沿用真实入口和表单，仅供应商、授权及用户数据使用隔离样本。
        for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]]) {
          await resizeLayout(width, height);
          const bounds = await measureLayout();
          assert.ok(bounds.confirm?.visible && bounds.preview?.visible, JSON.stringify(bounds));
          assert.ok(bounds.scrollHeight <= height && bounds.scrollWidth <= width, JSON.stringify(bounds));
          assert.equal(bounds.selectedTab, '文案');
          await captureLayout('确认前-' + width + 'x' + height);
          assertPagination(bounds);
          layoutRecord('L01-' + width, { ...bounds, left: await assertImageProportion() });
        }
        await resizeLayout(1366, 768);
        const longLink = 'https://www.xiaohongshu.com/explore/layout-test?token=' + 'x'.repeat(1200);
        await layoutEval(value => { const el = document.querySelector('#image-text-link'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.scrollLeft = el.scrollWidth; }, longLink);
        const topbar = await layoutEval(() => { const row = document.querySelector('[data-testid=image-text-topbar]'); const title = row.querySelector('h1').getBoundingClientRect(); const link = row.querySelector('input').getBoundingClientRect(); return { titleY: title.y + title.height / 2, linkY: link.y + link.height / 2, rowHeight: row.clientHeight, inputHeight: link.height, inputTag: row.querySelector('input').tagName, linkLength: row.querySelector('input').value.length, inputScroll: row.querySelector('input').scrollLeft }; });
        assert.ok(Math.abs(topbar.titleY - topbar.linkY) < 2 && topbar.rowHeight < 60 && topbar.linkLength === longLink.length && topbar.inputScroll > 0, JSON.stringify(topbar));
        await layoutEval(() => { const el = document.querySelector('#image-text-link'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); });
        layoutRecord('U01-header', topbar);
        await setLabel('话题（空格分隔）', '布局验收 输入保留');
        await selectLayoutTab('逐图'); await selectLayoutTab('文案');
        assert.equal(await readLayoutLabel('话题（空格分隔）'), '布局验收 输入保留');
        await setLabel('话题（空格分隔）', initialDraft.tags.join(' '));
        await layoutEval(() => { const el = Array.from(document.querySelectorAll('[aria-label=图文策划与确认] label')).find(el => el.firstChild?.textContent === '话题（空格分隔）').querySelector('textarea'); el.focus(); el.blur(); });
        await clickText('下一图');
        assert.equal((await measureLayout()).selectedTab, '文案');
        assert.equal(await layoutEval(() => Array.from(document.querySelectorAll('[aria-label=图文编辑分页] [role=tab]')).find(el => el.textContent.startsWith('逐图')).textContent.trim()), '逐图 · 第 2 图');
        await selectLayoutTab('逐图');
        assert.equal(await readLayoutLabel('图片内文字'), initialDraft.pages[1].text);
        await setLabel('图片内文字', '第二图编辑保留'); await clickText('上一图'); await clickText('下一图');
        assert.equal(await readLayoutLabel('图片内文字'), '第二图编辑保留');
        await setLabel('图片内文字', initialDraft.pages[1].text);
        await selectLayoutTab('风格');
        await layoutEval(() => { const el = document.querySelector('[data-testid=image-text-plan-scroll]'); el.scrollTop = el.scrollHeight; });
        await selectLayoutTab('逐图');
        assert.equal(await layoutEval(() => document.querySelector('[data-testid=image-text-plan-scroll]').scrollTop), 0);
        layoutRecord('L02', { uncommittedTagsRetained: true, activePageEditingLinked: true, pageSwitchRetainsEdits: true, pageSwitchDoesNotChangeTab: true, tabScrollResets: true });
        await layoutEval(() => { document.querySelector('[aria-label="图片预览与翻页"]').focus(); });
        for (const [key, index] of [['ArrowLeft', 0], ['ArrowRight', 1]]) {
          window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key === 'ArrowLeft' ? 'Left' : 'Right' });
          window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key === 'ArrowLeft' ? 'Left' : 'Right' });
          await waitFor(window, 'document.querySelector("select[aria-label=选择图片]").selectedIndex === ' + index);
        }
        const ignoredKey = await layoutEval(() => { const el = document.querySelector('select[aria-label=选择图片]'); el.focus(); const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }); el.dispatchEvent(event); return { prevented: event.defaultPrevented, page: el.selectedIndex }; });
        assert.deepEqual(ignoredKey, { prevented: false, page: 1 });
        assert.equal(await layoutEval(() => document.querySelector('[data-testid=image-text-preview]').textContent.includes('方法介绍')), true);
        layoutRecord('R3-keyboard', { previous: true, next: true, inputIgnored: true, ungeneratedTextVisible: true });
        const pageIdsBeforeInsert = await layoutEval(() => Array.from(document.querySelector('select[aria-label=选择图片]').options).map(option => option.value));
        await insertPage('往前增加');
        await waitFor(window, 'document.querySelector("select[aria-label=选择图片]").options.length === 3');
        const insertedBefore = await layoutEval(() => { const el = document.querySelector('select[aria-label=选择图片]'); return { ids: Array.from(el.options).map(option => option.value), selected: el.value, index: el.selectedIndex }; });
        assert.deepEqual(insertedBefore.ids.filter(id => id !== insertedBefore.selected), pageIdsBeforeInsert); assert.equal(insertedBefore.index, 1);
        await clickText('删除当前图'); await waitFor(window, 'document.querySelector("select[aria-label=选择图片]").options.length === 2');
        const afterMiddleDeletion = await layoutEval(() => { const el = document.querySelector('select[aria-label=选择图片]'); return { ids: Array.from(el.options).map(option => option.value), selected: el.value, index: el.selectedIndex }; });
        assert.deepEqual(afterMiddleDeletion.ids, pageIdsBeforeInsert); assert.equal(afterMiddleDeletion.selected, pageIdsBeforeInsert[1]);
        assert.equal(await readLayoutLabel('图片内文字'), initialDraft.pages[1].text);
        layoutRecord('D01-delete-next', { deletedId: insertedBefore.selected, ...afterMiddleDeletion, nextPageContentRetained: true });
        await layoutEval(() => { const el = document.querySelector('select[aria-label=选择图片]'); el.selectedIndex = 1; el.dispatchEvent(new Event('change', { bubbles: true })); });
        layoutRecord('U06-insert-before', insertedBefore);
        for (let count = 3; count <= 6; count++) {
          await insertPage('往后增加');
          await waitFor(window, 'document.querySelector("select[aria-label=选择图片]").options.length === ' + count);
          await setLabel('图片内文字', '布局验收第 ' + count + ' 图');
          await setLabel('画面要求', '六张图片逐页核对实际场景');
        }
        for (let index = 0; index < 6; index++) {
          await layoutEval(i => { const el = document.querySelector('select[aria-label=选择图片]'); el.selectedIndex = i; el.dispatchEvent(new Event('change', { bubbles: true })); }, index);
          const bounds = await measureLayout();
          assert.ok(bounds.previous?.visible && bounds.next?.visible && bounds.text?.visible && bounds.visual?.visible && bounds.confirm?.visible, JSON.stringify(bounds));
          assert.ok(bounds.scrollHeight <= bounds.height, JSON.stringify(bounds));
          assert.equal(await readLayoutLabel('图片内文字'), index < 2 ? initialDraft.pages[index].text : '布局验收第 ' + (index + 1) + ' 图');
        }
        const pageActionRow = await layoutEval(() => { const heading = Array.from(document.querySelectorAll('#image-text-plan p')).find(el => el.textContent.startsWith('当前第')); const buttons = Array.from(heading.parentElement.querySelectorAll('button')); const center = el => { const rect = el.getBoundingClientRect(); return rect.y + rect.height / 2; }; return { headingY: center(heading), buttonYs: buttons.map(center), labels: buttons.map(el => el.textContent.trim()), rowFits: heading.parentElement.scrollWidth <= heading.parentElement.clientWidth }; });
        assert.deepEqual(pageActionRow.labels, ['增加一图', '删除当前图']); assert.ok(pageActionRow.rowFits && pageActionRow.buttonYs.every(y => Math.abs(y - pageActionRow.headingY) < 2), JSON.stringify(pageActionRow));
        layoutRecord('U05-page-action-row', pageActionRow);
        await captureLayout('六张逐图编辑-1366x768');
        layoutRecord('L03', { sixPageControlsInViewport: true, wholePageScrollNotRequired: true });
        for (let count = 6; count > 2; count--) {
          await layoutEval(() => { const el = document.querySelector('select[aria-label=选择图片]'); el.selectedIndex = el.options.length - 1; el.dispatchEvent(new Event('change', { bubbles: true })); });
          await clickText('删除当前图');
          await waitFor(window, 'document.querySelector("select[aria-label=选择图片]").options.length === ' + (count - 1));
          assert.equal(await layoutEval(() => { const el = document.querySelector('select[aria-label=选择图片]'); return el.selectedIndex === el.options.length - 1; }), true);
        }
        layoutRecord('D02-delete-last', { consecutiveLastPageDeletions: 4, previousPageSelected: true });
        // 单页隐藏翻页条，恢复两页后继续原有生成与优化流程。
        await layoutEval(() => { const el = document.querySelector('select[aria-label=选择图片]'); el.selectedIndex = 1; el.dispatchEvent(new Event('change', { bubbles: true })); });
        await clickText('删除当前图'); await waitFor(window, '!document.querySelector("[aria-label=图片分页]")');
        assert.equal(await layoutEval(() => Array.from(document.querySelectorAll('button')).some(el => el.textContent.trim() === '上一图' || el.textContent.trim() === '下一图')), false);
        await insertPage('往后增加'); await waitFor(window, 'document.querySelector("select[aria-label=选择图片]")?.options.length === 2');
        await setLabel('图片内文字', initialDraft.pages[1].text); await setLabel('画面要求', initialDraft.pages[1].visual);
        layoutRecord('R3-single-page', { paginationHidden: true, restoredMultiPage: true });
        const planLabels = await layoutEval(() => Array.from(document.querySelectorAll('[aria-label=图文编辑分页] [role=tab]')).map(el => el.textContent.trim()));
        assert.deepEqual(planLabels.map(label => label.split(' · ')[0]), ['文案', '逐图', '风格', '素材 ' + initialDraft.references.length]);
        assert.equal(await layoutEval(() => document.querySelector('#image-text-plan').textContent.includes('调整分页结构')), false);
        layoutRecord('L04', { planTabs: planLabels, automaticReviewPanelRemoved: true, structureDisclosureRemoved: true });
        await selectLayoutTab('文案');
        await resizeLayout(390, 844);
        let mobileBounds = await measureLayout();
        assert.ok(mobileBounds.confirm?.visible, JSON.stringify(mobileBounds));
        assert.ok(mobileBounds.scrollWidth <= mobileBounds.width && mobileBounds.scrollHeight <= mobileBounds.height, JSON.stringify(mobileBounds));
        await captureLayout('确认前-390x844');
        await clickText('图片预览');
        assert.ok((await measureLayout()).preview?.visible);
        assert.equal(await layoutEval(() => getComputedStyle(document.querySelector('#image-text-plan')).display), 'none');
        await clickText('策划编辑');
        assert.equal((await measureLayout()).selectedTab, '文案');
        layoutRecord('L05', { ...mobileBounds, mobilePanelsSwitch: true });
        await resizeLayout(1366, 768);
        let releaseImages;
        pendingImageResponse = new Promise(resolve => { releaseImages = resolve; });
        await clickText('确认文案、张数及比例，开始生成 2 张图片');
        await waitFor(window, 'Array.from(document.querySelectorAll("button")).some(el => el.textContent.trim() === "取消任务")');
        const generatingBounds = await measureLayout();
        assert.equal(generatingBounds.selectedTab, '发布文案');
        assert.ok(generatingBounds.retry?.visible && generatingBounds.progress?.visible && generatingBounds.cancel?.visible, JSON.stringify(generatingBounds));
        await layoutEval(() => { const el = document.querySelector('[data-testid=image-text-result-scroll]'); el.scrollTop = el.scrollHeight; });
        assert.ok((await measureLayout()).cancel?.visible);
        await resizeLayout(390, 844);
        assert.equal(await layoutEval(() => document.querySelector('[aria-controls=image-text-result]').getAttribute('aria-pressed')), 'true');
        assert.ok(await layoutEval(() => !!document.querySelector('[aria-controls=image-text-result] .animate-spin')));
        const generatingMobile = await measureLayout();
        assert.ok(generatingMobile.cancel?.visible && generatingMobile.scrollWidth <= generatingMobile.width, JSON.stringify(generatingMobile));
        await captureLayout('生成中-390x844');
        layoutRecord('L06', { desktop: generatingBounds, mobile: generatingMobile, autoSwitchesToResult: true, busySpinnerVisible: true, cancelRemainsVisibleAfterScroll: true });
        releaseImages(); pendingImageResponse = null;
        await resizeLayout(1366, 768);

        await waitFor(window, 'window.electronAPI.listImageTextHistory().then(r => r.data[0]?.pages.every(p => p.assetId))');
        assert.equal(imageCalls, 2);
        for (const request of imageRequests) {
          assert.ok(request.prompt.includes(JSON.stringify(initialDraft.remixContext)));
          assert.match(request.prompt, /不重新选择关联角度/);
          assert.doesNotMatch(request.prompt, /行业关联：原帖出行场景/);
        }
        layoutRecord('industry-remix-image-generation', { images: imageRequests.length, sameIndustryAsPlanning: true, approvedPagePreserved: true, analysisExcludedFromImage: true });
        const generated = (await imageHistory())[0];
        await waitFor(window, 'Boolean(document.querySelector("[data-testid=image-text-preview] img")?.complete)');
        for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080], [390, 844]]) {
          await resizeLayout(width, height);
          const bounds = await measureLayout();
          assert.ok(bounds.preview?.visible && bounds.previous?.visible && bounds.next?.visible, JSON.stringify(bounds));
          assert.ok(bounds.scrollWidth <= width && bounds.scrollHeight <= height, JSON.stringify(bounds));
          await captureLayout('生成后-' + width + 'x' + height);
          assertPagination(bounds);
          layoutRecord('L07-' + width, bounds);
        }
        await resizeLayout(1366, 768);
        await selectLayoutTab('发布文案');
        assert.ok(await layoutEval(() => document.querySelector('[data-testid=image-text-title]').getBoundingClientRect().height > 0));
        assert.equal(await layoutEval(() => { const section = document.querySelector('[data-testid=image-text-plan-scroll]'); const notices = section.querySelector('[data-testid=image-text-plan-notices]'); return !notices.open && section.lastElementChild === notices; }), true);
        assert.equal(await layoutEval(() => !!document.querySelector('[aria-label=图文结果] h2')), false);
        assert.deepEqual(await layoutEval(() => Array.from(document.querySelectorAll('[aria-label=图文编辑分页] [role=tab]')).map(el => el.textContent.trim())), ['发布文案', '素材 ' + generated.references.length]);
        await layoutEval(() => { window.layoutClipboardWrite = navigator.clipboard.writeText; navigator.clipboard.writeText = async text => { window.layoutCopiedText = text; }; });
        const directPublication = { title: 'U03 人工发布标题', body: 'U03 人工编辑正文，仅保存不生图', tags: ['U03最新话题', '不失焦也保留'] };
        await setLabel('发布标题', directPublication.title); await setLabel('配套发布正文', directPublication.body); await setLabel('话题（空格分隔）', directPublication.tags.join(' '));
        await clickText('复制文案'); await waitFor(window, 'document.body.innerText.includes("发布文案已复制")');
        const copiedPublication = await layoutEval(() => window.layoutCopiedText);
        assert.ok(copiedPublication.includes(directPublication.title) && copiedPublication.includes(directPublication.body) && copiedPublication.includes('#不失焦也保留'));
        await layoutEval(() => { navigator.clipboard.writeText = window.layoutClipboardWrite; delete window.layoutClipboardWrite; delete window.layoutCopiedText; });
        assert.equal(await layoutEval(() => document.querySelectorAll('header button').length > 0 && Array.from(document.querySelectorAll('header button')).every(el => el.textContent.trim() !== '复制文案')), true);
        await clickText('保存'); await waitFor(window, 'window.electronAPI.listImageTextHistory().then(r => r.data[0].title === ' + JSON.stringify(directPublication.title) + ' && r.data[0].tags.includes("不失焦也保留"))');
        assert.equal(imageCalls, 2);
        await layoutEval(() => document.querySelector('nav button[aria-label=历史记录]').click()); await waitFor(window, 'Boolean(document.querySelector("[data-testid=history-record]"))');
        await layoutEval(() => document.querySelector('[data-testid=history-record]').click()); await clickText('重新编辑');
        await waitFor(window, 'document.querySelector("[data-testid=image-text-title]")?.value === ' + JSON.stringify(directPublication.title));
        assert.equal(await readLayoutLabel('配套发布正文'), directPublication.body); assert.deepEqual((await imageHistory())[0].tags, directPublication.tags);
        await setLabel('发布标题', generated.title); await setLabel('配套发布正文', generated.body); await setLabel('话题（空格分隔）', generated.tags.join(' ')); await clickText('保存');
        await waitFor(window, 'window.electronAPI.listImageTextHistory().then(r => r.data[0].title === ' + JSON.stringify(generated.title) + ')');
        const versionPlacement = await layoutEval(() => { const details = document.querySelector('[data-testid=image-text-detail-scroll]'); const description = details.querySelector('details'); const version = details.querySelector('select[aria-label=页面版本]').closest('label'); const review = details.querySelector('input[type=checkbox]').closest('label'); return { versionAfterDescription: !!(description.compareDocumentPosition(version) & Node.DOCUMENT_POSITION_FOLLOWING), reviewAfterVersion: !!(version.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING), imageColumnHasNoVersion: !document.querySelector('[data-testid=image-text-image-column]').querySelector('select[aria-label=页面版本],input[type=checkbox]') }; });
        assert.deepEqual(versionPlacement, { versionAfterDescription: true, reviewAfterVersion: true, imageColumnHasNoVersion: true });
        layoutRecord('U02-version-position', versionPlacement);
        layoutRecord('U03-edit-publication', { editableTitleBodyTags: true, copiedLatestTagsWithoutBlur: true, savedAndReopened: true, imageCallsUnchanged: imageCalls, duplicateCopyRemoved: true });
        await layoutEval(() => document.querySelectorAll('button[aria-label=关闭提示]').forEach(el => el.click()));
        await waitFor(window, '!document.querySelector("button[aria-label=关闭提示]")');
        const assetDirectory = path.join(dataDirectory, 'image-text-assets');
        const beforeImportFiles = fs.readdirSync(assetDirectory).sort();
        const invalidReferenceFile = path.join(dataDirectory, 'invalid-scene.png');
        fs.writeFileSync(invalidReferenceFile, 'invalid-image');
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [referenceFile, invalidReferenceFile] });
        const importReference = () => window.webContents.executeJavaScript('window.electronAPI.selectImageTextReferences("scene",' + JSON.stringify(generated) + ')');
        assert.equal((await importReference()).success, false);
        assert.deepEqual(fs.readdirSync(assetDirectory).sort(), beforeImportFiles);
        assert.deepEqual((await imageHistory())[0].references, generated.references);
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [referenceFile] });
        const originalSaveImageTextRecord = LocalSQLiteManager.prototype.saveImageTextRecord;
        LocalSQLiteManager.prototype.saveImageTextRecord = async () => { throw new Error('测试参考图归档失败'); };
        try {
          assert.equal((await importReference()).success, false);
          assert.deepEqual(fs.readdirSync(assetDirectory).sort(), beforeImportFiles);
        } finally { LocalSQLiteManager.prototype.saveImageTextRecord = originalSaveImageTextRecord; }
        await clickText('下一图');
        await clickText('图片优化');
        await waitFor(window, 'Boolean(document.querySelector("[role=dialog]"))');
        await setLabel('本图文字', '取消后不应保留的修改');
        await clickText('为本图补传实际场景图（可选）');
        await waitFor(window, 'document.querySelector("[role=dialog]").textContent.includes("scene.png")');
        const imported = (await imageHistory())[0];
        assert.equal(imported.references.length, 1);
        assert.deepEqual(imported.pages, generated.pages);
        await clickText('取消');
        await waitFor(window, '!document.querySelector("[role=dialog]")');
        assert.equal(imageCalls, 2);
        assert.equal((await imageHistory())[0].references.length, 1);
        await clickText('图片优化');
        await waitFor(window, 'document.querySelector("[role=dialog]")?.textContent.includes("scene.png")');
        await setLabel('本图文字', '用户修订第二图');
        await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[role=dialog] label")).find(el => el.textContent.includes("scene.png")).querySelector("input[type=checkbox]").click()');
        await clickText('优化并重生成本图');
        await waitFor(window, 'window.electronAPI.listImageTextHistory().then(r => r.data[0]?.pages[1].text === "用户修订第二图" && r.data[0].pages[1].assetId !== ' + JSON.stringify(generated.pages[1].assetId) + ')');
        const singleOptimized = (await imageHistory())[0];
        assert.equal(imageCalls, 3); assert.equal(singleOptimized.pages[0].assetId, generated.pages[0].assetId);
        assert.equal(singleOptimized.pages[1].referenceIds.length, 1); assert.equal(imageRequests.at(-1).extra_body.image.length, 1);
        await clickText('全局优化');
        await waitFor(window, 'Boolean(document.querySelector("[role=dialog]"))');
        await setLabel('配套发布正文', '只修改发布正文');
        await clickText('仅更新文案');
        await waitFor(window, 'window.electronAPI.listImageTextHistory().then(r => r.data[0]?.body === "只修改发布正文")');
        assert.equal(imageCalls, 3);
        await clickText('全局优化');
        await waitFor(window, 'Boolean(document.querySelector("[role=dialog]"))');
        await setLabel('全局优化指令（可选，填写后调用文本模型重新策划）', '优化第二页');
        await clickText('生成优化预览');
        await waitFor(window, 'Array.from(document.querySelectorAll("button")).some(el => el.textContent.trim() === "应用全局优化" && !el.disabled)');
        assert.equal(imageCalls,3);
        await clickText('应用全局优化');
        await waitFor(window, 'window.electronAPI.listImageTextHistory().then(r => r.data[0]?.pages[1].text === "优化后的方法介绍" && r.data[0].pages[1].assetId !== ' + JSON.stringify(singleOptimized.pages[1].assetId) + ')');
        assert.equal(imageCalls, 4);
        assert.equal((await imageHistory())[0].pages[0].assetId, generated.pages[0].assetId);
        await clickText('全局优化');
        await waitFor(window, 'Boolean(document.querySelector("[role=dialog]"))');
        await setLabel('整套比例', '1:1'); await clickText('应用全局优化');
        await waitFor(window, 'window.electronAPI.listImageTextHistory().then(r => r.data[0]?.ratio === "1:1" && r.data[0].pages.every(p => p.renderedKey.includes("1:1")))');
        assert.equal(imageCalls, 6);
        const beforeVersions = (await imageHistory())[0];
        assert.ok(beforeVersions.versions.length >= 6);
        await window.webContents.executeJavaScript('document.querySelector("[aria-label=图文结果] input[type=checkbox]").click()');
        await waitFor(window, 'window.electronAPI.listImageTextHistory().then(r => r.data[0].pages[1].reviewedVersionId === r.data[0].pages[1].currentVersionId)');
        const historicalVersion = beforeVersions.versions.find(v => v.pageId === beforeVersions.pages[1].id);
        await window.webContents.executeJavaScript('(() => {const el=document.querySelector("select[aria-label=页面版本]");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,' + JSON.stringify(historicalVersion.id) + ');el.dispatchEvent(new Event("change",{bubbles:true}));})()');
        await waitFor(window, 'window.electronAPI.listImageTextHistory().then(r => r.data[0].pages[1].assetId === ' + JSON.stringify(historicalVersion.assetId) + ' && !r.data[0].pages[1].reviewedVersionId)');
        assert.equal(imageCalls,6);
        await window.webContents.executeJavaScript('(() => {const el=document.querySelector("select[aria-label=页面版本]");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,' + JSON.stringify(beforeVersions.pages[1].currentVersionId) + ');el.dispatchEvent(new Event("change",{bubbles:true}));})()');
        await waitFor(window, 'window.electronAPI.listImageTextHistory().then(r => r.data[0].pages[1].assetId === ' + JSON.stringify(beforeVersions.pages[1].assetId) + ')');
        assert.equal(imageCalls,6);
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dataDirectory] });
        await clickText('导出素材包');
        await waitFor(window, 'document.body.innerText.includes("素材包已导出到")');
        const exportDirectory = fs.readdirSync(dataDirectory).find(name => name.startsWith('小红书图文-'));
        assert.deepEqual(fs.readdirSync(path.join(dataDirectory, exportDirectory)).sort(), ['01.png', '02.png', '内部核对.txt', '发布文案.txt']);
        assert.ok(fs.readFileSync(path.join(dataDirectory, exportDirectory, '发布文案.txt'), 'utf8').includes('只修改发布正文'));
        const longHistoryDraft = (await imageHistory())[0];
        longHistoryDraft.body += '\n' + '历史长文滚动验收，图片和翻页保持固定。\n'.repeat(80);
        assert.equal((await call('saveImageTextHistory', longHistoryDraft)).success, true);
        window.setSize(390, 844);
        await waitFor(window, 'window.innerWidth < 500');
        assert.equal(await window.webContents.executeJavaScript('document.documentElement.scrollWidth <= window.innerWidth'), true);
        window.setSize(1440, 900);
        await window.webContents.executeJavaScript('document.querySelector("nav button[aria-label=历史记录]").click()');
        await waitFor(window, 'Boolean(document.querySelector("[aria-label=内容类型筛选]"))');
        await clickText('图文');
        await waitFor(window, 'Boolean(document.querySelector("[data-testid=history-record]"))');
        assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll("[data-testid=history-record]").length'), 1);
        await window.webContents.executeJavaScript('document.querySelector("[data-testid=history-record]").click()');
        await waitFor(window, 'document.querySelector("[aria-label=历史详情] h2")?.textContent === ' + JSON.stringify(beforeVersions.title));
        assert.equal(await layoutEval(() => document.querySelector('[aria-label=历史详情] h2')?.textContent), beforeVersions.title);
        assert.ok(await layoutEval(() => document.querySelector('[aria-label=历史详情]').textContent.includes('只修改发布正文')));
        for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080], [390, 844]]) {
          await resizeLayout(width, height);
          const bounds = await measureLayout(); assertPagination(bounds);
          assert.ok(bounds.scrollWidth <= width, JSON.stringify(bounds));
          const ratio = await panelProportion('[aria-label=历史详情]', '[data-testid=image-text-result-scroll]');
          if (width >= 1024) assert.ok(ratio.proportion >= .8 && ratio.widthProportion > .5, JSON.stringify(ratio));
          const columns = await layoutEval(() => { const el = document.querySelector('[data-testid=image-text-result-scroll]').firstElementChild; const children = el.children; const a = children[0].getBoundingClientRect(); const b = children[1].getBoundingClientRect(); return { width: el.parentElement.clientWidth, sideBySide: b.x >= a.right, stacked: b.y >= a.bottom }; });
          assert.ok(columns.width >= 520 ? columns.sideBySide : columns.stacked, JSON.stringify(columns));
          const historyScroll = await layoutEval(() => {
            const column = document.querySelector('[data-testid=image-text-image-column]'); const preview = column.querySelector('[data-testid=image-text-preview]'); const text = document.querySelector('[data-testid=image-text-detail-scroll]'); const img = preview.querySelector('img'); const pagination = column.querySelector('[aria-label=图片分页]'); const before = preview.getBoundingClientRect();
            text.scrollTop = text.scrollHeight;
            const after = preview.getBoundingClientRect();
            return { imageOverflow: getComputedStyle(column).overflowY, textOverflow: getComputedStyle(text).overflowY, textScrolled: text.scrollTop > 0, columnHeight: column.clientHeight, previewHeight: preview.clientHeight, pagerHeight: pagination.clientHeight, imageHeight: img.clientHeight, objectFit: getComputedStyle(img).objectFit, fixedAfterTextScroll: before.y === after.y && before.height === after.height, imageColumnNoScroll: column.scrollHeight <= column.clientHeight, pagerAtBottom: Math.abs(column.getBoundingClientRect().bottom - pagination.getBoundingClientRect().bottom) < 2 };
          });
          assert.equal(historyScroll.imageOverflow, 'hidden'); assert.equal(historyScroll.textOverflow, 'auto'); assert.equal(historyScroll.objectFit, 'contain');
          assert.ok(historyScroll.textScrolled && historyScroll.imageColumnNoScroll && historyScroll.fixedAfterTextScroll && historyScroll.pagerAtBottom && historyScroll.previewHeight >= historyScroll.columnHeight - historyScroll.pagerHeight - 16, JSON.stringify(historyScroll));
          layoutRecord('U08-history-fixed-' + width, historyScroll);
          layoutRecord('R5-history-image-' + width, { ...ratio, ...columns, pagination: bounds.pagination, preview: bounds.preview }); await captureLayout('历史图文-' + width + 'x' + height);
        }
        await resizeLayout(390, 844); await layoutEval(() => document.querySelector('[aria-label=返回列表]').click());
        assert.equal(await layoutEval(() => getComputedStyle(document.querySelector('[aria-label=历史详情]')).display), 'none');
        await layoutEval(() => document.querySelector('[data-testid=history-record]').click());
        await resizeLayout(1366, 768);
        layoutRecord('L08', { historyPublicationPreserved: true, mobileBackToList: true });
        await clickText('重新编辑');
        await waitFor(window, 'Boolean(document.querySelector("[aria-label=图文结果] img"))');
        const beforeDelete = (await imageHistory())[0];
        const deletionInfo = await call('getImageTextDeletionInfo',beforeDelete.id);
        assert.equal(deletionInfo.success,true); assert.ok(deletionInfo.data.count >= 7);
        await window.webContents.executeJavaScript('document.querySelector("nav button[aria-label=历史记录]").click()');
        await waitFor(window, 'Boolean(document.querySelector("[aria-label=内容类型筛选]"))');
        await clickText('图文');
        await waitFor(window, 'Boolean(document.querySelector("button[aria-label^=删除记录]"))');
        await window.webContents.executeJavaScript('document.querySelector("button[aria-label^=删除记录]").click()');
        await waitFor(window, 'document.querySelector("[role=dialog]")?.textContent.includes("个图片文件")');
        await clickText('取消');
        assert.equal((await imageHistory()).length,1);
      } finally {
        globalThis.fetch = beforeImageFetch; dialog.showOpenDialog = beforeDialog; window.hide();
        LocalProviderService.prototype.read = originalRead;
      }
      await require(path.join(__dirname, 'trendingSmoke.cjs'))({ window, call, waitFor, LocalProviderService, platforms: require(path.join(applicationPath, 'dist-electron', 'services', 'trendingTypes.js')).TRENDING_PLATFORMS, version: require(path.join(applicationPath, 'package.json')).version });
      await new Promise(resolve => providerServer.close(resolve));
      const status = await call('getAuthStatus');
      assert.equal(status.user.username,'admin');
      assert.equal(status.user.password_hash,undefined);
      assert.equal((await call('setUserActive',{userId:status.user.id,active:false})).errorCode,'PROTECTED_ACCOUNT');
      await window.webContents.executeJavaScript('document.querySelector("nav button[aria-label=账号管理]").click()');
      await waitFor(window, "document.body.innerText.includes('新增账号')");
      await window.webContents.executeJavaScript('document.querySelector("nav button[aria-label=设置]").click()');
      await waitFor(window, 'Boolean(document.querySelector("[aria-label=设置分类]"))');
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[aria-label=设置分类] [role=tab]")).find(el => el.textContent === "系统设置").click()');
      await waitFor(window, 'Array.from(document.querySelectorAll("summary")).some(el => el.textContent.includes("诊断与日志"))');
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("summary")).find(el => el.textContent.includes("诊断与日志")).click()');
      await waitFor(window, 'document.body.innerText.includes("打开运行日志")');
      const originalOpenPath = shell.openPath;
      let resolveOpenPath;
      const openedLogDirectory = new Promise(resolve => { resolveOpenPath = resolve; });
      shell.openPath = async target => { resolveOpenPath(target); return ''; };
      try {
        await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(el => el.textContent.includes("打开运行日志")).click()');
        assert.equal(await openedLogDirectory,logDirectory);
      } finally { shell.openPath = originalOpenPath; }
      const server = http.createServer((_req, res) => {
        res.writeHead(429, {'Content-Type':'application/json'});
        res.end(JSON.stringify({message:'LOG_PRIVATE_UPSTREAM_RESPONSE'}));
      });
      await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
      try {
        const failure = await call('parseVideo',{rawInput:'https://v.douyin.com/demo/',
          apiEndpoint:'http://127.0.0.1:' + server.address().port,apiKey:'LOG_PRIVATE_API_KEY'});
        assert.equal(failure.errorCode,'QUOTA_EXHAUSTED');
      } finally { await new Promise(resolve => server.close(resolve)); }
      const created = await call('createUser',{username:'smoke_member',displayName:'测试成员',password,role:'member'});
      assert.equal(created.success,true);
      const parsed = await call('parseVideo',{rawInput:'https://xhslink.com/demo/',enableMockFallback:true});
      assert.equal(parsed.success,false); assert.equal(parsed.errorCode,'API_ERROR');
      assert.equal('isMockData' in parsed,false);
      const missingKey = await call('generateScriptStream',{requestId:'smoke',config:{apiKey:'',baseURL:'',model:''},
        systemPrompt:'',userPrompt:'',targetDurationSec:18,userCameraWork:''});
      assert.equal(missingKey.success,false);
      assert.ok(missingKey.error.includes('接口密钥'));
      const knowledge = await call('parseKnowledgeBuffer',{name:'验证资料.txt',sizeBytes:0,base64Data:Buffer.from('真实业务资料').toString('base64')});
      assert.equal(knowledge.success,true); assert.equal(knowledge.doc.fullContent,'真实业务资料');
      for (const [name,expected] of [['knowledge.pdf','Company knowledge sample'],['knowledge.docx','企业知识库：核心产品与业务卖点。']]) {
        const buffer = fs.readFileSync(path.join(__dirname,'..','tests','fixtures',name));
        const document = await call('parseKnowledgeBuffer',{name,sizeBytes:buffer.length,base64Data:buffer.toString('base64')});
        assert.equal(document.success,true);
        assert.ok(document.doc.fullContent.includes(expected));
      }
      const database = await call('getDatabaseInfo');
      assert.ok(database.info.dbPath.startsWith(dataDirectory));
      const history = await call('listHistoryFromDB');
      assert.equal(history.success,true); assert.ok(history.records.length > 0);
      // 历史删除只在确认后提交；取消、关闭和失败都保留数据。
      const deleteRecord = {...history.records[0], id:randomUUID(), title:'删除确认验收记录'};
      assert.equal((await call('saveHistoryToDB',deleteRecord)).success,true);
      const originalDelete = LocalSQLiteManager.prototype.deleteRecord;
      let deleteCalls = 0;
      let deleteMode = 'fail';
      let releaseDelete;
      LocalSQLiteManager.prototype.deleteRecord = async function (id) {
        if (id === deleteRecord.id) {
          deleteCalls++;
          if (deleteMode === 'fail') throw new Error('测试数据库暂时不可写');
          await new Promise(resolve => { releaseDelete = resolve; });
        }
        return originalDelete.call(this,id);
      };
      try {
        window.setSize(1440,900);
        await window.webContents.executeJavaScript('document.querySelector("nav button[aria-label=历史记录]").click()');
        const deleteSelector = 'button[aria-label="删除记录 删除确认验收记录"]';
        await waitFor(window,'Boolean(document.querySelector(' + JSON.stringify(deleteSelector) + '))');
        for (const [width,height] of [[1440,900],[390,844]]) {
          window.setSize(width,height);
          await window.webContents.executeJavaScript('{ const button=document.querySelector(' + JSON.stringify(deleteSelector) + ');button.focus();button.click(); }');
          await waitFor(window,'document.activeElement?.textContent.trim() === "取消"');
          await waitFor(window,'(() => {const popup=document.querySelector("[role=dialog]");if(!popup)return false;const rect=popup.getBoundingClientRect();return Math.abs(rect.top+rect.height/2-innerHeight/2)<3})()');
          const dialog = await window.webContents.executeJavaScript('(() => {const popup=document.querySelector("[role=dialog]");const rect=popup.getBoundingClientRect();return {text:popup.textContent,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,centerY:rect.top+rect.height/2,width:innerWidth,height:innerHeight}})()');
          assert.ok(dialog.text.includes(deleteRecord.title));
          assert.ok(dialog.text.includes('不可撤销'));
          assert.ok(dialog.left>=0 && dialog.right<=dialog.width && dialog.top>=0 && dialog.bottom<=dialog.height);
          assert.ok(Math.abs(dialog.centerY-dialog.height/2)<3);
          assert.equal(deleteCalls,0);
          assert.ok((await call('listHistoryFromDB')).records.some(record=>record.id===deleteRecord.id));
          await window.webContents.executeJavaScript('document.activeElement.click()');
          await waitFor(window,'!document.querySelector("[role=dialog]")');
          assert.equal(deleteCalls,0);
        }
        window.setSize(1440,900);
        // Escape 和关闭按钮同样不提交删除，焦点回到原删除入口。
        for (const method of ['escape','close']) {
          await window.webContents.executeJavaScript('{ const button=document.querySelector(' + JSON.stringify(deleteSelector) + ');button.focus();button.click(); }');
          await waitFor(window,'document.activeElement?.textContent.trim() === "取消"');
          if (method==='escape') {
            window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
            window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
          } else await window.webContents.executeJavaScript('document.querySelector("[role=dialog] button[aria-label=关闭]").click()');
          await waitFor(window,'!document.querySelector("[role=dialog]")');
          await waitFor(window,'document.activeElement?.getAttribute("aria-label") === "删除记录 删除确认验收记录"');
          assert.equal(deleteCalls,0);
        }
        await window.webContents.executeJavaScript('document.querySelector(' + JSON.stringify(deleteSelector) + ').click()');
        await waitFor(window,'document.activeElement?.textContent.trim() === "取消"');
        await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[role=dialog] button")).find(button=>button.textContent.trim()==="确认删除").click()');
        await waitFor(window,'document.querySelector("[role=dialog] [role=alert]")?.textContent.includes("测试数据库暂时不可写")');
        assert.equal(deleteCalls,1);
        assert.ok((await call('listHistoryFromDB')).records.some(record=>record.id===deleteRecord.id));
        // 失败后重试期间双击只提交一次，关闭和 Escape 均不打断删除。
        deleteMode = 'pending';
        await window.webContents.executeJavaScript('{const button=Array.from(document.querySelectorAll("[role=dialog] button")).find(button=>button.textContent.trim()==="确认删除");button.click();button.click();}');
        await waitFor(window,'document.querySelector("[role=dialog]")?.textContent.includes("正在删除…")');
        await waitFor(window,'Array.from(document.querySelectorAll("[role=dialog] button")).every(button=>button.disabled)');
        assert.equal(deleteCalls,2);
        assert.ok(releaseDelete);
        window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
        window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
        assert.ok(await window.webContents.executeJavaScript('Boolean(document.querySelector("[role=dialog]"))'));
        releaseDelete();
        await waitFor(window,'!document.querySelector("[role=dialog]")');
        const remaining = await call('listHistoryFromDB');
        assert.deepEqual(remaining.records.map(record=>record.id).sort(),history.records.map(record=>record.id).sort());
        assert.equal(deleteCalls,2);
      } finally { LocalSQLiteManager.prototype.deleteRecord = originalDelete; }
      await call('logout');
      assert.equal((await call('listHistoryFromDB')).errorCode,'AUTH_REQUIRED');
      assert.equal((await call('login',{username:'smoke_member',password})).success,true);
      assert.equal((await call('listUsers')).errorCode,'FORBIDDEN');
      // 重载前端，确认普通成员无法看到账号管理入口。
      await window.webContents.reload();
      await new Promise((resolve) => window.webContents.once('did-finish-load',resolve));
      await waitFor(window, 'Boolean(document.querySelector("[data-testid=editable-transcript]"))');
      assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('nav button[aria-label=账号管理]'))"),false);
      await call('login',{username:'admin',password});
      await call('setUserActive',{userId:created.user.id,active:false});
      assert.equal((await call('login',{username:'smoke_member',password})).errorCode,'ACCOUNT_DISABLED');
      const info = await call('getDatabaseInfo');
      // 被停用的登录不会继续持有先前管理员会话。
      assert.equal(info.errorCode,'AUTH_REQUIRED');
      const rendererGone = new Promise(resolve => window.webContents.once('render-process-gone',resolve));
      window.webContents.forcefullyCrashRenderer();
      await rendererGone;
      const entries = readLogs();
      assert.ok(entries.some(entry => entry.event === 'renderer.error'));
      assert.ok(entries.some(entry => entry.event === 'renderer.unhandled-rejection'));
      assert.ok(entries.some(entry => entry.event === 'window.renderer-gone'));
      const serviceFailure = entries.find(entry => entry.event === 'service.video-failed' && entry.error.status === 429);
      assert.ok(serviceFailure);
      assert.ok(entries.some(entry => entry.operationId === serviceFailure.operationId && entry.channel === 'video:parse' && entry.outcome === 'failed'));
      assert.ok(entries.some(entry => entry.channel === 'db:history:save' && entry.event === 'operation.failed' && entry.error));
      assert.ok(entries.some(entry => entry.channel === 'auth:create-user' && entry.actorId && entry.outcome === 'success'));
      const checkEntries = entries.filter(entry => entry.event === 'image-text.check');
      assert.ok(checkEntries.some(entry => entry.kind === 'assets') && checkEntries.some(entry => entry.kind === 'evidence') && checkEntries.some(entry => entry.kind === 'forbidden'));
      for (const entry of checkEntries) {
        assert.ok(entry.targetId && ['success', 'failed'].includes(entry.outcome));
        assert.ok(Object.keys(entry).every(key => ['timestamp','level','event','sessionId','pid','targetId','kind','outcome'].includes(key)), JSON.stringify(entry));
      }
      layoutRecord('U04-check-logs', { count: checkEntries.length, structuredResultsOnly: true, automaticChecksHiddenFromUI: true });
      const logText = JSON.stringify(entries);
      for (const secret of [password,'人工修订后的企业口播','真实业务资料','LOG_PRIVATE_RENDERER_ERROR',
        'LOG_PRIVATE_RENDERER_REJECTION','LOG_PRIVATE_API_KEY','LOG_PRIVATE_UPSTREAM_RESPONSE','U03 人工编辑正文，仅保存不生图','U03最新话题']) {
        assert.equal(logText.includes(secret),false,'日志不应包含凭据或正文');
      }
      app.once('before-quit', () => assert.ok(readLogs().some(entry => entry.event === 'app.stopping')));
      if (testAuthServer) await new Promise(resolve => { testAuthServer.close(resolve); testAuthServer.closeAllConnections(); });
      globalThis.fetch = originalFetch;
      completed = true;
      console.log('桌面验证通过：首屏、管理员登录或初始化、角色权限、停用拦截、提取后人工修订二创及原稿保存、图文自动分流与一次确认、Agnes 协议回放、单图素材优化与全局差异生图、素材包导出、统一历史恢复、跨记录生成隔离、保存失败提示、知识库、历史删除确认（取消/关闭/失败重试/重复点击/桌面与移动端）、运行日志及异常追踪。');
      clearTimeout(timer);
      app.quit();
    } catch (error) {
      console.error(error);
      const output = process.env.REMIX_SMOKE_OUTPUT || path.join(__dirname, '../release');
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'desktop-failure.json'), JSON.stringify({ message: error.message,
        dialogs: await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[role=dialog]")).map(el => el.innerText)').catch(() => []),
        logs: readLogs().slice(-30) }, null, 2));
      clearTimeout(timer); app.exit(1);
    }
  });
});
app.on('quit', () => {
  globalThis.fetch = originalFetch;
  try { fs.rmSync(dataDirectory,{recursive:true,force:true}); } catch {}
  if (!completed) process.exitCode = 1;
});
preparePackagedAuth().then(() => require(path.join(applicationPath, 'dist-electron', 'main.js')))
  .catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
