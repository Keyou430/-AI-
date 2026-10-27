const { app, shell } = require('electron');
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
  const origin = new URL(JSON.parse(fs.readFileSync(path.join(applicationPath, 'dist-electron/auth-config.json'), 'utf8')).url).origin;
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
const timer = setTimeout(() => { console.error('桌面验证超时'); app.exit(1); }, 90000);
const waitFor = async (window, expression) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('界面未达到预期状态：' + expression);
};

app.on('browser-window-created', (_event, window) => {
  window.show = () => {};
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
      // 通过实际首屏表单完成管理员初始化或远程登录。
      await window.webContents.executeJavaScript(
        (remotePackage ? 'document.querySelector("[name=username]").value="admin";' : 'document.querySelector("[name=displayName]").value="测试管理员";') +
        'document.querySelector("[name=password]").value=' + JSON.stringify(password) + ';' +
        'document.querySelector("form").requestSubmit();');
      await waitFor(window, 'Boolean(document.querySelector("nav button[aria-label=账号管理]"))');
      assert.equal((await call('listHistoryFromDB')).records.length, 0);
      // 测试响应仅由验收脚本的本地 HTTP/SSE 服务提供，产品只走真实请求。
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
        const prompt = JSON.parse(body).messages.at(-1).content;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const script = '【分镜脚本总览】共1个镜头，总时长18秒\n【镜头1 | 0-18秒】\n▪️人员动作分工：出镜人员展示产品，摄影师跟拍\n▪️运镜与拍摄执行标准：近景平视\n▪️声音内容：接口生成验收\n' + prompt;
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
      await waitFor(window, "document.body.innerText.includes('基于人工修改后的文案')");
      await window.webContents.executeJavaScript('document.querySelector("[data-testid=generate-script]").click()');
      await waitFor(window, 'window.electronAPI.listHistoryFromDB().then(result => result.records.some(record => record.originalTranscript === "人工修订后的企业口播"))');
      const manualRecord = (await call('listHistoryFromDB')).records.find(record => record.originalTranscript === '人工修订后的企业口播');
      assert.ok(manualRecord.conversationMessages[0].content.includes('人工修订后的企业口播'));
      assert.ok(manualRecord.sourceContent.transcript); assert.notEqual(manualRecord.sourceContent.transcript,manualRecord.originalTranscript);
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
      // 图文走正式 LinkDigest 解析器，测试响应由本机提供，不调用商业接口。
      const beforeImageFetch = globalThis.fetch;
      LocalProviderService.prototype.read = function () { return { ...originalRead.call(this),
        videoParserProvider: 'linkdigest', videoParserApiKey: 'fixture-key', linkDigestMaxCredits: 5 }; };
      globalThis.fetch = (input, init) => String(input) === 'https://linkdigest.dev/api/v1/digest'
        ? beforeImageFetch(baseURL + '/image-digest', init) : beforeImageFetch(input, init);
      try {
        await window.webContents.executeJavaScript('{ const input = document.querySelector("[name=sourceVideoUrl]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"https://www.xiaohongshu.com/explore/image-note"); input.dispatchEvent(new Event("input",{bubbles:true})); }');
        await window.webContents.executeJavaScript('document.querySelector("[data-testid=extract-video]").click()');
        await waitFor(window, 'document.querySelector("[data-testid=editable-transcript]")?.value.includes("图文验收图片原文")');
        assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-testid=editable-transcript]").value.includes("图文验收正文")'), true);
        assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-testid=source-keywords]").textContent.includes("外贸")'), true);
        assert.equal(await window.webContents.executeJavaScript('document.body.innerText.includes("使用当前图文与业务设置")'), true);
        assert.equal(await window.webContents.executeJavaScript('document.body.innerText.includes("未返回口播")'), false);
        assert.equal(await window.webContents.executeJavaScript('document.body.innerText.includes("未取得口播文字")'), false);
        assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-testid=generate-script]").disabled'), false);
        window.setSize(390, 844);
        await waitFor(window, 'window.innerWidth < 500');
        assert.equal(await window.webContents.executeJavaScript('document.documentElement.scrollWidth <= window.innerWidth'), true);
        window.setSize(1440, 900);
      } finally {
        globalThis.fetch = beforeImageFetch;
        LocalProviderService.prototype.read = originalRead;
      }
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
      const logText = JSON.stringify(entries);
      for (const secret of [password,'人工修订后的企业口播','真实业务资料','LOG_PRIVATE_RENDERER_ERROR',
        'LOG_PRIVATE_RENDERER_REJECTION','LOG_PRIVATE_API_KEY','LOG_PRIVATE_UPSTREAM_RESPONSE']) {
        assert.equal(logText.includes(secret),false,'日志不应包含凭据或正文');
      }
      app.once('before-quit', () => assert.ok(readLogs().some(entry => entry.event === 'app.stopping')));
      if (testAuthServer) await new Promise(resolve => { testAuthServer.close(resolve); testAuthServer.closeAllConnections(); });
      globalThis.fetch = originalFetch;
      completed = true;
      console.log('桌面验证通过：首屏、管理员登录或初始化、角色权限、停用拦截、提取后人工修订二创及原稿保存、图文自动填入及关键词展示、跨记录生成隔离、保存失败提示、知识库、历史删除确认（取消/关闭/失败重试/重复点击/桌面与移动端）、运行日志及异常追踪。');
      clearTimeout(timer);
      app.quit();
    } catch (error) {
      console.error(error); clearTimeout(timer); app.exit(1);
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
