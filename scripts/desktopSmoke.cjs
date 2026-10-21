const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-remix-smoke-'));
app.setPath('userData', dataDirectory);
const applicationPath = path.resolve(process.argv[2] || '.');
const password = 'Test-' + randomUUID();
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
      assert.equal((await call('parseVideo',{rawInput:'https://v.douyin.com/demo/',enableMockFallback:true})).errorCode,'AUTH_REQUIRED');
      // 通过实际首屏表单完成管理员初始化。
      await window.webContents.executeJavaScript(
        'document.querySelector("[name=displayName]").value="测试管理员";' +
        'document.querySelector("[name=password]").value=' + JSON.stringify(password) + ';' +
        'document.querySelector("form").requestSubmit();');
      await waitFor(window, "document.body.innerText.includes('账号管理')");
      // 验证自动流程实际生成并保存，再验证人工修订内容进入提示词与历史。
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(el => el.textContent.includes("一键提取并二创")).click()');
      await waitFor(window, 'window.electronAPI.listHistoryFromDB().then(result => result.records.length === 2)');
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(el => el.textContent.includes("仅提取文案")).click()');
      await waitFor(window, "document.body.innerText.includes('已成功提取原视频文案')");
      assert.equal((await call('listHistoryFromDB')).records.length,2);
      await window.webContents.executeJavaScript('const textarea = document.querySelector("textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(textarea,"人工修订后的企业口播"); textarea.dispatchEvent(new Event("input",{bubbles:true}));');
      await waitFor(window, "document.body.innerText.includes('基于人工修改后的文案')");
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(el => el.textContent.includes("基于人工修改后的文案")).click()');
      await waitFor(window, 'window.electronAPI.listHistoryFromDB().then(result => result.records.some(record => record.originalTranscript === "人工修订后的企业口播"))');
      const manualRecord = (await call('listHistoryFromDB')).records.find(record => record.originalTranscript === '人工修订后的企业口播');
      assert.ok(manualRecord.conversationMessages[0].content.includes('人工修订后的企业口播'));
      const status = await call('getAuthStatus');
      assert.equal(status.user.username,'admin');
      assert.equal(status.user.password_hash,undefined);
      assert.equal((await call('setUserActive',{userId:status.user.id,active:false})).errorCode,'PROTECTED_ACCOUNT');
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("nav button")).find(el => el.textContent.includes("账号管理")).click()');
      await waitFor(window, "document.body.innerText.includes('新增账号')");
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
      completed = true;
      console.log('桌面验证通过：首屏、管理员初始化、角色权限、停用拦截、自动与手动二创、知识库、历史记录。');
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
