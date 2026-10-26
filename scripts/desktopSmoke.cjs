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
      await waitFor(window, "document.body.innerText.includes('初始化管理员')");
      assert.ok(readLogs().some(entry => entry.event === 'app.start'));
      assert.ok(readLogs().some(entry => entry.event === 'database.ready'));
      assert.equal((await call('openLogFolder')).errorCode,'AUTH_REQUIRED');
      // 实际触发前端 Error 和 Promise rejection，确认登录前也能留痕且不记录消息正文。
      await window.webContents.executeJavaScript('setTimeout(() => { throw new Error("LOG_PRIVATE_RENDERER_ERROR"); }, 0); setTimeout(() => { Promise.reject(new Error("LOG_PRIVATE_RENDERER_REJECTION")); }, 0); true;');
      await waitFor(window, 'window.electronAPI.getAuthStatus().then(() => true)');
      assert.equal((await call('parseVideo',{rawInput:'https://v.douyin.com/demo/',enableMockFallback:true})).errorCode,'AUTH_REQUIRED');
      // 通过实际首屏表单完成管理员初始化。
      await window.webContents.executeJavaScript(
        'document.querySelector("[name=displayName]").value="测试管理员";' +
        'document.querySelector("[name=password]").value=' + JSON.stringify(password) + ';' +
        'document.querySelector("form").requestSubmit();');
      await waitFor(window, "document.body.innerText.includes('账号管理')");
      // 提取不自动二创，人工修改后才生成；原稿和修改稿分别保存。
      const beforeExtract = (await call('listHistoryFromDB')).records.length;
      await window.webContents.executeJavaScript('document.querySelector("[data-testid=extract-video]").click()');
      await waitFor(window, "document.body.innerText.includes('当前为示例数据')");
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
        await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(el => el.textContent.includes("多轮对话优化")).click()');
        await waitFor(window, 'Boolean(document.querySelector("#optimize-form textarea"))');
        await window.webContents.executeJavaScript(
          '{ const textarea = document.querySelector("#optimize-form textarea");' +
          'Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(textarea,' + JSON.stringify(instruction) + ');' +
          'textarea.dispatchEvent(new Event("input",{bubbles:true})); }');
        await waitFor(window, '!document.querySelector("button[form=optimize-form]").disabled');
        await window.webContents.executeJavaScript('document.querySelector("#optimize-form").requestSubmit()');
        await waitFor(window, 'document.body.innerText.includes("AI 结合业务二创中")');
      };
      await refine('强化原记录A的产品卖点');
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("nav button")).find(el => el.textContent.includes("历史记录")).click()');
      await waitFor(window, 'document.body.innerText.includes("切换记录B")');
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("div.cursor-pointer")).find(el => el.textContent.includes("切换记录B")).click()');
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(el => el.textContent.includes("重新编辑")).click()');
      await waitFor(window, 'document.querySelector("textarea")?.value === "记录B独立口播"');
      await waitFor(window, 'Boolean(document.querySelector("[data-testid=extract-video]:not(:disabled)"))');
      const afterRefine = (await call('listHistoryFromDB')).records;
      assert.equal(afterRefine.find(record => record.id === otherRecord.id).rawGeneratedScript,otherRecord.rawGeneratedScript);
      assert.equal(afterRefine.find(record => record.id === manualRecord.id).refinementHistory.length,manualRecord.refinementHistory.length + 1);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("textarea").value'),otherRecord.originalTranscript);
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[role=tab]")).find(el => el.textContent.includes("标准格式全文")).dispatchEvent(new MouseEvent("mousedown",{bubbles:true,button:0,ctrlKey:false}))');
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
      const status = await call('getAuthStatus');
      assert.equal(status.user.username,'admin');
      assert.equal(status.user.password_hash,undefined);
      assert.equal((await call('setUserActive',{userId:status.user.id,active:false})).errorCode,'PROTECTED_ACCOUNT');
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("nav button")).find(el => el.textContent.includes("账号管理")).click()');
      await waitFor(window, "document.body.innerText.includes('新增账号')");
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("nav button")).find(el => el.textContent.includes("系统设置")).click()');
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
        const failure = await call('parseVideo',{rawInput:'https://v.douyin.com/demo/',enableMockFallback:false,
          apiEndpoint:'http://127.0.0.1:' + server.address().port,apiKey:'LOG_PRIVATE_API_KEY'});
        assert.equal(failure.errorCode,'QUOTA_EXHAUSTED');
      } finally { await new Promise(resolve => server.close(resolve)); }
      const created = await call('createUser',{username:'smoke_member',displayName:'测试成员',password,role:'member'});
      assert.equal(created.success,true);
      const parsed = await call('parseVideo',{rawInput:'https://xhslink.com/demo/',enableMockFallback:true});
      assert.equal(parsed.success,true); assert.equal(parsed.isMockData,true);
      const missingKey = await call('generateScriptStream',{requestId:'smoke',config:{apiKey:'',baseURL:'',model:''},
        systemPrompt:'',userPrompt:'',targetDurationSec:18,userCameraWork:'',enableMockFallback:false});
      assert.equal(missingKey.success,false);
      assert.ok(missingKey.error.includes('API Key'));
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
      await call('logout');
      assert.equal((await call('listHistoryFromDB')).errorCode,'AUTH_REQUIRED');
      assert.equal((await call('login',{username:'smoke_member',password})).success,true);
      assert.equal((await call('listUsers')).errorCode,'FORBIDDEN');
      // 重载前端，确认普通成员无法看到账号管理入口。
      await window.webContents.reload();
      await new Promise((resolve) => window.webContents.once('did-finish-load',resolve));
      await waitFor(window, "document.body.innerText.includes('二创工作台')");
      assert.equal(await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('nav button')).some(el => el.textContent.includes('账号管理'))"),false);
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
      completed = true;
      console.log('桌面验证通过：首屏、管理员初始化、角色权限、停用拦截、提取后人工修订二创及原稿保存、跨记录生成隔离、保存失败提示、知识库、历史记录、运行日志及异常追踪。');
      clearTimeout(timer);
      app.quit();
    } catch (error) {
      console.error(error); clearTimeout(timer); app.exit(1);
    }
  });
});
app.on('quit', () => {
  try { fs.rmSync(dataDirectory,{recursive:true,force:true}); } catch {}
  if (!completed) process.exitCode = 1;
});
require(path.join(applicationPath,'dist-electron','main.js'));
