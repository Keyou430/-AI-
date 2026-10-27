const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-persistence-'));
  const root = path.resolve(process.argv.slice(2).find(value => !value.startsWith('--')) || path.join(__dirname, '..'));
  try {
    const remote = process.argv.includes('--remote');
    const password = remote ? fs.readFileSync(process.env.REMIX_SMOKE_ADMIN_FILE, 'utf8').split(/\r?\n/)
      .find(line => line.startsWith('初始密码：'))?.slice('初始密码：'.length).trim() : 'Test-' + randomUUID();
    assert.ok(password);

    for (const phase of ['seed', 'edit', 'verify', 'linkdigest', 'review', 'fresh']) {
      const result = spawnSync(require('electron'), [__filename, root, directory, phase, ...(remote ? ['--remote'] : [])], {
        env: { ...process.env, REMIX_TEST_PASSWORD: password }, encoding: 'utf8', timeout: 60000,
        windowsHide: true,
      });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
      console.log(result.stdout.trim());
    }
    fs.mkdirSync(path.join(root, 'release'), { recursive: true });
    fs.writeFileSync(path.join(root, 'release', remote ? 'universal-persistence-acceptance.json' : 'local-persistence-acceptance.json'), JSON.stringify({
      verifiedAt: new Date().toISOString(), version: require(path.join(root, 'package.json')).version,
      authentication: remote ? 'server' : 'local-test-only', serverBusinessRequests: 0, systemEncryption: true, processRestarts: 5, knowledgePersistence: true,
      sidebarStateAcrossProcessRestarts: true, keywordPersistence: true, apiKeyPersistence: true, updatesPersisted: true, directProviderRoutingWithFixture: true,
      parserProtocolPersistence: true, configurableRequestVerified: true,
      aggregateProviderFixtureVerified: true, linkDigestAsyncFixtureVerified: true, linkDigestOcrOrderVerified: true, linkDigestBudgetPersistence: true, editedGenerationWithoutReextract: true, sourceSnapshotPersistence: true, partialTranscriptionWarning: true,
      freshDeviceEmpty: true, plaintextKeysAbsent: true,
    }, null, 2) + '\n');
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
} else {
  const { app, safeStorage } = require('electron');
  const root = path.resolve(process.argv[2]);
  const phase = process.argv[4];
  const remote = process.argv.includes('--remote');
  const directory = path.join(path.resolve(process.argv[3]), phase === 'fresh' ? 'fresh' : 'original');
  app.setPath('userData', directory);
  const password = process.env.REMIX_TEST_PASSWORD;
  const empty = { llmBaseUrl: '', llmModel: '', videoParserEndpoint: '', llmKeyConfigured: false, videoKeyConfigured: false };
  const key = 'PERSIST_TEST_MODEL_SECRET';
  const updatedKey = 'PERSIST_TEST_MODEL_UPDATED_SECRET';
  const videoKey = 'PERSIST_TEST_VIDEO_SECRET';
  const parserOptions = { method: 'GET', authMode: 'query', apiKeyName: 'api_key', urlField: 'share_url',
    textPath: 'payload.transcript', titlePath: 'payload.title', timeoutSeconds: 120 };
  let directParserCalls = 0; let directModelCalls = 0; let partialTranscription = false;
  let linkDigestPosts = 0; let linkDigestPolls = 0;
  const linkDigestFixture = {platform:'douyin',title:'LinkDigest 视频',author:'测试作者',caption:'LinkDigest 发布正文',
    transcript:[{t:0,text:'LinkDigest 原始口播'},{t:2,text:'第二段口播'}],duration_seconds:18,read_seconds:18,
    images:[],ocr_text:['视频 OCR'],on_screen:[{t:2,text:'画面文字'}],key_points:['摘要不是原稿'],degraded:[],credits:3,cached:false,
    coverage:{seconds_transcribed:18,duration_seconds:18,images_read:0,images_total:0,not_captured:[]}};
  const imageFixture = {...linkDigestFixture,platform:'xiaohongshu',transcript:[],duration_seconds:undefined,read_seconds:undefined,
    images:[{ocr:'第一张图片文字',description:'第一图'},null,{ocr:'第三张图片文字',description:'第三图'}],
    coverage:{images_read:2,images_total:3,not_captured:[]}};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const address = new URL(typeof input === 'string' ? input : input.url || input);
    if (address.hostname === '114.132.186.95') {
      assert.ok(['/v1/login', '/v1/me', '/v1/logout', '/v1/users', '/v1/users/create', '/v1/users/status', '/v1/users/password'].includes(address.pathname));
      for (const secret of [key, updatedKey, videoKey]) assert.equal(String(init?.body || '').includes(secret), false);
    }
    if (address.hostname === 'parser.example.com') {
      assert.equal(init?.method, 'GET');
      assert.equal(new Headers(init?.headers).get('Authorization'), null);
      assert.equal(address.searchParams.get('api_key'), videoKey);
      assert.equal(address.searchParams.get('share_url'), 'https://v.douyin.com/demo/');
      assert.equal(init?.body, undefined);
      directParserCalls++;
      return new Response(JSON.stringify({ payload: { transcript: '本机接口验收口播', title: '本机解析验收' } }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (address.hostname === 'cyanlis.cn') {
      const douyin = address.pathname === '/api/plugins/douyin/dy_video_to_text';
      assert.ok(douyin || address.pathname === '/api/plugins/xiaohongshu/video_to_text');
      assert.equal(init?.method, 'GET'); assert.equal(address.searchParams.get(douyin ? 'api_key' : 'apiKey'), videoKey);
      assert.equal(address.searchParams.get('use_own_key'), 'false');
      assert.equal(address.searchParams.get('url'), douyin ? 'https://v.douyin.com/fixture/' : 'https://xhslink.cn/fixture/');
      directParserCalls++;
      return new Response(JSON.stringify({success:true,code:0,data:{desc:'聚合发布正文',title:'聚合标题',type:'video',
        audio_text: partialTranscription ? '部分口播待核对' : '聚合原始口播',is_audio_success:!partialTranscription,duration:18000}}));
    }
    if (address.hostname === 'linkdigest.dev') {
      assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer ' + videoKey);
      assert.equal(init?.redirect,'error');
      if(init?.method === 'POST'){
        linkDigestPosts++;
        const body=JSON.parse(init.body);
        assert.equal(body.max_credits,7);assert.equal(body.partial_ok,false);assert.equal(body.depth,'full');assert.equal(body.format,'json');
        if(body.url.includes('/blocked/'))return new Response(JSON.stringify({error_code:'platform_refused',message:videoKey}),{status:503});
        if(body.url.includes('xhslink.cn'))return new Response(JSON.stringify(imageFixture));
        assert.equal(body.url,'https://v.douyin.com/linkdigest-fixture/');
        return new Response(JSON.stringify({pending:true,jobId:'desktop-fixture',poll:'https://not-trusted.example/'}),{status:202});
      }
      assert.equal(address.pathname,'/api/v1/digest/desktop-fixture');assert.equal(address.searchParams.get('wait'),'20');
      linkDigestPolls++;
      return new Response(JSON.stringify(linkDigestPolls===1?{pending:true,jobId:'desktop-fixture'}:linkDigestFixture),{status:linkDigestPolls===1?202:200});
    }
    if (address.hostname === 'api.deepseek.com') {
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + updatedKey);
      const payload = JSON.parse(init.body); assert.equal(payload.model, 'deepseek-flash'); assert.equal(payload.stream, true);
      assert.ok(payload.messages.some(message => (message.content.includes('聚合人工修改稿') && message.content.includes('聚合发布正文')) ||
        (message.content.includes('LinkDigest 人工修改稿') && message.content.includes('LinkDigest 发布正文')) ||
        (message.content.includes('第一张图片文字') && message.content.includes('第三张图片文字'))));
      directModelCalls++;
      return new Response('data: ' + JSON.stringify({choices:[{delta:{content:'聚合二创验收输出'}}]}) + '\n\ndata: [DONE]\n\n', {headers:{'Content-Type':'text/event-stream'}});
    }
    if (address.hostname === 'api.example.com') {
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + updatedKey);
      const payload = JSON.parse(init.body); assert.equal(payload.model, 'updated-model'); directModelCalls++;
      if (payload.stream) return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: '本机生成验收' } }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
      return new Response(JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }), { headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, init);
  };
  const timer = setTimeout(() => { console.error('持久化桌面验收超时：' + phase); app.exit(1); }, 45000);
  const waitFor = async (window, expression) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('界面未达到预期状态：' + expression);
  };
  app.on('browser-window-created', (_event, window) => {
    window.show = () => {};
    window.setContentSize(1440, 900);
    window.webContents.once('did-finish-load', async () => {
      try {
        const js = expression => window.webContents.executeJavaScript(expression);
        const call = (method, payload) => js('window.electronAPI[' + JSON.stringify(method) + '](' + (payload === undefined ? '' : JSON.stringify(payload)) + ')');
        if (remote) {
          await waitFor(window, 'Boolean(document.querySelector("[name=username]"))');
          await js('document.querySelector("[name=username]").value="admin"; document.querySelector("[name=password]").value=' + JSON.stringify(password) + '; document.querySelector("form").requestSubmit()');
        } else if (phase === 'seed' || phase === 'fresh') {
          await waitFor(window, 'Boolean(document.querySelector("[name=displayName]"))');
          await js('document.querySelector("[name=displayName]").value="持久化测试"; document.querySelector("[name=password]").value=' + JSON.stringify(password) + '; document.querySelector("form").requestSubmit()');
        } else {
          await waitFor(window, 'Boolean(document.querySelector("[name=username]"))');
          await js('document.querySelector("[name=username]").value="admin"; document.querySelector("[name=password]").value=' + JSON.stringify(password) + '; document.querySelector("form").requestSubmit()');
        }
        await waitFor(window, 'Boolean(document.querySelector("[data-testid=editable-transcript]"))');
        assert.equal(await js('document.querySelector("aside").dataset.collapsed'), phase === 'edit' ? 'true' : 'false');
        if (phase === 'seed' || phase === 'edit') {
          await js('document.querySelector("aside button[aria-controls=desktop-navigation]").click()');
          await waitFor(window, 'document.querySelector("aside").dataset.collapsed === ' + JSON.stringify(phase === 'seed' ? 'true' : 'false'));
        }
        await js('document.querySelector("nav button[aria-label=设置]").click()');
        await waitFor(window, 'Boolean(document.querySelector("[aria-label=设置分类]"))');
        await js('Array.from(document.querySelectorAll("[aria-label=设置分类] [role=tab]")).find(el => el.textContent === "系统设置").click()');
        await waitFor(window, 'Array.from(document.querySelectorAll("button")).some(el => el.textContent.includes("保存本设备接口配置") && !el.disabled)');
        const storage = () => js('JSON.parse(localStorage.getItem("video-remix-ai-full-v3-storage")).state');
        const docs = async () => (await call('listKnowledgeDocsFromDB')).docs;
        const { LocalProviderService } = require(path.join(root, 'dist-electron/services/localProviderService.js'));
        const provider = new LocalProviderService(directory, safeStorage);
        assert.ok(safeStorage.isEncryptionAvailable());
        if (phase === 'seed' || phase === 'fresh') {
          assert.deepEqual(await call('getProviderSettings').then(r => r.config), empty);
          assert.deepEqual((await storage()).keywords, []);
          assert.deepEqual(await docs(), []);
        } else {
          assert.equal(provider.read().llmApiKey, phase === 'edit' ? key : updatedKey);
          assert.equal(provider.read().videoParserApiKey, videoKey);
          assert.equal(provider.read().llmModel, phase === 'edit' ? 'initial-model' : ['linkdigest','review'].includes(phase) ? 'deepseek-flash' : 'updated-model');
          if (phase === 'verify') {
            assert.deepEqual(provider.publicSettings().videoParserOptions, parserOptions);
            assert.equal(await js('document.getElementsByName("videoParserOptions.method")[0].value'), 'GET');
            assert.equal(await js('document.getElementsByName("videoParserOptions.textPath")[0].value'), parserOptions.textPath);
          }
          if(phase === 'linkdigest'){
            assert.equal(provider.publicSettings().videoParserProvider,'yaoan');
            const saved=(await call('listHistoryFromDB')).records.find(record=>record.originalTranscript==='聚合人工修改稿');
            assert.equal(saved.sourceContent.transcript,'聚合原始口播');
            assert.equal((await storage()).parsedVideo.transcriptionStatus,'failed');
          }
          if(phase === 'review'){
            assert.equal(provider.publicSettings().videoParserProvider,'linkdigest');assert.equal(provider.publicSettings().linkDigestMaxCredits,7);
            assert.equal(await js('document.getElementsByName("videoParserProvider")[0].value'),'linkdigest');
            assert.equal(await js('document.getElementsByName("linkDigestMaxCredits")[0].value'),'7');
            const records=(await call('listHistoryFromDB')).records;
            const saved=records.find(record=>record.originalTranscript==='LinkDigest 人工修改稿');
            assert.equal(saved.sourceContent.transcript,'LinkDigest 原始口播\n第二段口播');
            assert.equal(saved.sourceContent.extractionDetails.onScreen[0].text,'画面文字');
            const imageRecord=records.find(record=>record.sourceContent?.extractionDetails?.images.length===3);
            assert.equal(imageRecord.sourceContent.extractionDetails.images[1].ocr,'');
            assert.equal(imageRecord.sourceContent.extractionDetails.images[2].ocr,'第三张图片文字');
            assert.equal((await storage()).parsedVideo.extractionDetails.images.length,3);
            assert.ok((await storage()).editedTranscript.includes('第三张图片文字'));
            await js('document.querySelector("nav button[aria-label=历史记录]").click()');
            await waitFor(window,'document.querySelectorAll("[data-testid=history-record]").length > 0');
            await js('Array.from(document.querySelectorAll("[role=tab]")).find(el=>el.textContent.includes("原稿对照")).click()');
            await waitFor(window,'Boolean(document.querySelector("[data-testid=extraction-details]"))');
            assert.equal(await js('document.querySelectorAll("[data-testid=image-ocr]").length'),3);
            await js('document.querySelector("nav button[aria-label=设置]").click()');
            await waitFor(window, 'Boolean(document.querySelector("[aria-label=设置分类]"))');
            await js('Array.from(document.querySelectorAll("[aria-label=设置分类] [role=tab]")).find(el => el.textContent === "系统设置").click()');
          }
          assert.deepEqual((await storage()).keywords.map(k => k.text), [phase === 'edit' ? '首次关键词' : '修改关键词']);
          assert.equal((await docs())[0].fullContent, '持久化知识库正文');
          assert.equal((await docs())[0].enabled, phase === 'edit');
        }
        if (phase === 'seed' || phase === 'edit') {
          await js('Array.from(document.querySelectorAll("[aria-label=设置分类] [role=tab]")).find(el => el.textContent === "内容设置").click()');
          if (phase === 'edit') {
            await js('document.querySelector("button[aria-label^=移除关键词]").click()');
            const doc = (await docs())[0];
            assert.equal((await call('toggleKnowledgeDocInDB', { id: doc.id, enabled: false })).success, true);
          }
          const keyword = phase === 'seed' ? '首次关键词' : '修改关键词';
          await js('{ const input = document.querySelector("#new-keyword"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,' + JSON.stringify(keyword) + '); input.dispatchEvent(new Event("input", { bubbles: true })); }');
          await js('document.querySelector("#new-keyword").form.requestSubmit()');
          await waitFor(window, 'document.body.innerText.includes(' + JSON.stringify(keyword) + ')');
          await js('Array.from(document.querySelectorAll("[aria-label=设置分类] [role=tab]")).find(el => el.textContent === "系统设置").click()');
          const values = { llmBaseUrl: 'https://api.example.com/v1', llmModel: phase === 'seed' ? 'initial-model' : 'updated-model',
            llmApiKey: phase === 'seed' ? key : updatedKey, videoParserEndpoint: 'https://parser.example.com/parse',
            videoParserApiKey: phase === 'seed' ? videoKey : '' };
          await js('{ const values = ' + JSON.stringify(values) + '; for (const [name, value] of Object.entries(values)) { const input = document.getElementsByName(name)[0]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); } }');
          if (phase === 'edit') {
            await js('{ document.querySelector("details").open = true; for (const [name, value] of Object.entries({ method: "GET", authMode: "query" })) { const select = document.getElementsByName("videoParserOptions." + name)[0]; select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); } }');
            await waitFor(window, '!!document.getElementsByName("videoParserOptions.apiKeyName")[0]');
            await js('{ const options = ' + JSON.stringify(parserOptions) + '; for (const name of ["apiKeyName", "urlField", "textPath", "titlePath", "timeoutSeconds"]) { const input = document.getElementsByName("videoParserOptions." + name)[0]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input, String(options[name])); input.dispatchEvent(new Event("input", { bubbles: true })); } }');
          }
          await js('Array.from(document.querySelectorAll("form")).find(el => el.innerText.includes("保存本设备接口配置")).requestSubmit()');
          await waitFor(window, 'document.body.innerText.includes("本设备接口配置已加密保存")');
          assert.equal(await js('Array.from(document.querySelectorAll("input[type=password]")).every(el => el.value === "")'), true);
          if (phase === 'seed') {
            assert.equal((await call('parseKnowledgeBuffer', { name: '持久化资料.txt', sizeBytes: 0, base64Data: Buffer.from('持久化知识库正文').toString('base64') })).success, true);
          }
        }
        if (phase === 'verify') {
          const parsed = await call('parseVideo', { rawInput: 'https://v.douyin.com/demo/' });
          assert.equal(parsed.success, true); assert.equal(parsed.data.transcript, '本机接口验收口播');
          assert.equal(parsed.data.title, '本机解析验收');
          assert.equal((await call('testLLMConnection', {})).success, true);
          const generated = await call('generateScriptStream', { requestId: 'local-direct', config: { apiKey: '', baseURL: '', model: '' },
            systemPrompt: '本机提示词', userPrompt: '本机提示词', targetDurationSec: 18, userCameraWork: '' });
          assert.equal(generated.success, true); assert.equal(generated.fullText, '本机生成验收');
          assert.equal(directParserCalls, 1); assert.equal(directModelCalls, 2);
          // 通过设置页选择聚合预设与 DeepSeek，通过实际 IPC 调用接口和模型流。
          await js('Array.from(document.querySelectorAll("button")).find(el => el.textContent.includes("使用 DeepSeek 配置")).click()');
          await js('{ const select = document.getElementsByName("videoParserProvider")[0]; select.value="yaoan"; select.dispatchEvent(new Event("change",{bubbles:true})); }');
          await waitFor(window, '!document.getElementsByName("videoParserEndpoint")[0]');
          await js('{ const input=document.getElementsByName("videoParserApiKey")[0]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,' + JSON.stringify(videoKey) + '); input.dispatchEvent(new Event("input",{bubbles:true})); }');
          await js('Array.from(document.querySelectorAll("form")).find(el => el.innerText.includes("保存本设备接口配置")).requestSubmit()');
          await waitFor(window, 'document.body.innerText.includes("本设备接口配置已加密保存")');
          assert.equal(provider.publicSettings().videoParserProvider,'yaoan');
          await js('document.querySelector("nav button[aria-label=二创工作台]").click()');
          const extract = async (url, expected) => {
            await waitFor(window, 'Boolean(document.querySelector("[name=sourceVideoUrl]"))');
            await js('{const input=document.getElementsByName("sourceVideoUrl")[0]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,' + JSON.stringify(url) + '); input.dispatchEvent(new Event("input",{bubbles:true}));}');
            await waitFor(window, '!document.querySelector("[data-testid=extract-video]").disabled');
            await js('document.querySelector("[data-testid=extract-video]").click()');
            await waitFor(window, 'document.querySelector("[data-testid=editable-transcript]")?.value === ' + JSON.stringify(expected));
            assert.equal(await js('document.querySelector("[data-testid=published-text]").textContent'),'聚合发布正文');
          };
          const countBefore = (await call('listHistoryFromDB')).records.length;
          await extract('https://v.douyin.com/fixture/', '聚合原始口播');
          assert.equal(directModelCalls,2); assert.equal((await call('listHistoryFromDB')).records.length,countBefore);
          await js('{const input=document.querySelector("[data-testid=editable-transcript]"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"聚合人工修改稿"); input.dispatchEvent(new Event("input",{bubbles:true}));}');
          await js('document.querySelector("[data-testid=generate-script]").click()');
          await waitFor(window,'window.electronAPI.listHistoryFromDB().then(result => result.records.some(record => record.originalTranscript === "聚合人工修改稿"))');
          assert.equal(directParserCalls,2); assert.equal(directModelCalls,3);
          await extract('https://xhslink.cn/fixture/', '聚合原始口播');
          assert.equal(directParserCalls,3);
          partialTranscription = true;
          await extract('https://xhslink.cn/fixture/', '部分口播待核对');
          await waitFor(window,'document.body.innerText.includes("口播转写失败")');
          assert.equal(directParserCalls,4); assert.equal(directModelCalls,3);
        }
        if (phase === 'linkdigest') {
          await js('{const select=document.getElementsByName("videoParserProvider")[0];select.value="linkdigest";select.dispatchEvent(new Event("change",{bubbles:true}));}');
          await waitFor(window,'Boolean(document.getElementsByName("linkDigestMaxCredits")[0])');
          await js('{for(const [name,value] of Object.entries({videoParserApiKey:' + JSON.stringify(videoKey) + ',linkDigestMaxCredits:"7"})){const input=document.getElementsByName(name)[0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));}}');
          await js('Array.from(document.querySelectorAll("form")).find(el=>el.innerText.includes("保存本设备接口配置")).requestSubmit()');
          await waitFor(window,'document.body.innerText.includes("本设备接口配置已加密保存")');
          assert.equal(provider.publicSettings().videoParserProvider,'linkdigest');
          await js('document.querySelector("nav button[aria-label=二创工作台]").click()');
          const extract=async(url)=>{
            await waitFor(window,'Boolean(document.querySelector("[name=sourceVideoUrl]"))');
            await js('{const input=document.getElementsByName("sourceVideoUrl")[0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,'+JSON.stringify(url)+');input.dispatchEvent(new Event("input",{bubbles:true}));}');
            await waitFor(window, '!document.querySelector("[data-testid=extract-video]").disabled');
            await js('document.querySelector("[data-testid=extract-video]").click()');
          };
          await extract('https://v.douyin.com/linkdigest-fixture/');
          await waitFor(window,'document.querySelector("[data-testid=editable-transcript]")?.value === "LinkDigest 原始口播\\n第二段口播"');
          assert.equal(linkDigestPosts,1);assert.equal(linkDigestPolls,2);assert.equal(directModelCalls,0);
          await js('{const input=document.querySelector("[data-testid=editable-transcript]");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"LinkDigest 人工修改稿");input.dispatchEvent(new Event("input",{bubbles:true}));}');
          await js('document.querySelector("[data-testid=generate-script]").click()');
          await waitFor(window,'window.electronAPI.listHistoryFromDB().then(result=>result.records.some(record=>record.originalTranscript==="LinkDigest 人工修改稿"))');
          assert.equal(linkDigestPosts,1);assert.equal(directModelCalls,1);
          await extract('https://xhslink.cn/image-fixture/');
          await waitFor(window,'document.querySelectorAll("[data-testid=image-ocr]").length === 3');
          assert.ok(await js('document.querySelectorAll("[data-testid=extraction-warning]").length > 0'));
          await js('document.querySelector("[data-testid=use-extracted-text]").click()');
          await waitFor(window,'document.querySelector("[data-testid=editable-transcript]").value.includes("第三张图片文字")');
          const draft=await js('document.querySelector("[data-testid=editable-transcript]").value');
          assert.ok(draft.indexOf('第一张图片文字')<draft.indexOf('第三张图片文字'));
          await js('document.querySelector("[data-testid=generate-script]").click()');
          await waitFor(window,'window.electronAPI.listHistoryFromDB().then(result=>result.records.some(record=>record.sourceContent?.extractionDetails?.images.length===3))');
          assert.equal(linkDigestPosts,2);assert.equal(directModelCalls,2);
          await extract('https://v.douyin.com/blocked/');
          await waitFor(window,'document.body.innerText.includes("平台暂时拒绝 LinkDigest")');
          assert.equal(linkDigestPosts,3);assert.equal(linkDigestPolls,2);assert.equal(directModelCalls,2);
        }
        if (phase !== 'fresh') {
          const encrypted = fs.readFileSync(path.join(directory, 'providers.encrypted'));
          const browserStorage = JSON.stringify(await storage());
          const logText = fs.readdirSync(path.join(directory, 'logs')).map(name => fs.readFileSync(path.join(directory, 'logs', name), 'utf8')).join('');
          for (const secret of [key, updatedKey, videoKey]) {
            assert.equal(encrypted.includes(Buffer.from(secret)), false);
            assert.equal(browserStorage.includes(secret), false);
            assert.equal(logText.includes(secret), false);
          }
          await call('logout');
          assert.equal(provider.publicSettings().llmKeyConfigured, true);
        }
        console.log('持久化桌面验收通过：' + phase);
        clearTimeout(timer); app.quit();
      } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
    });
  });
  const applicationPath = remote ? path.join(root, 'release/win-unpacked/resources/app.asar') : root;
  if (remote) assert.equal(require(path.join(applicationPath, 'package.json')).authMode, 'remote');
  require(path.join(applicationPath, 'dist-electron/main.js'));
}
