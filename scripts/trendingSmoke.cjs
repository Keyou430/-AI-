const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { nativeImage } = require('electron');

module.exports = async function trendingSmoke({ window, call, waitFor, LocalProviderService, platforms, version }) {
  const originalFetch = globalThis.fetch;
  const originalRead = LocalProviderService.prototype.read;
  const beforeVideo = new Set((await call('listHistoryFromDB')).records.map(record => record.id));
  const beforeImage = new Set((await call('listImageTextHistory')).data.map(record => record.id));
  let requests = 0; let images = 0;
  const availablePlatformCount = platforms.filter(platform => platform !== 'wechat_channels').length;
  const transferPlatform = platforms.includes('toutiao') ? 'toutiao' : 'weibo';
  const transferPlatformLabel = transferPlatform === 'toutiao' ? '今日头条' : '微博';
  const rankedTitles = []; const layouts = []; const associationInputs = [];
  const outputDirectory = process.env.REMIX_SMOKE_OUTPUT || path.join(__dirname, '../release');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const unrelatedTitle = '明星演唱会官宣·热点桌面验收';
  const title = '新能源汽车电池续航·热点桌面验收';
  const server = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    const { messages, stream } = JSON.parse(body);
    const system = messages[0].content;
    const input = messages.at(-1).content;
    let content;
    if (system.includes('企业新媒体定位顾问')) content = JSON.stringify({ primaryIndustry: '新能源汽车', subCategories: ['新能源汽车', '电池', '续航'], targetAudience: '车主', corePainPoints: ['续航'], suggestedAngles: ['实测科普'] });
    else if (system.includes('企业新媒体选题策划师')) {
      const candidates = JSON.parse(input).candidates; rankedTitles.push(...candidates.map(item => item.title));
      content = JSON.stringify(candidates.map(item => ({ id: item.id, relevanceScore: 90, remixAngle: '从电池续航科普切入企业专业服务。', suggestedHook: '续航数据应该怎么看？', matchKeywords: ['续航'] })));
    }
    else if (system.includes('小红书图文策划师')) {
      const source = JSON.parse(input).source;
      assert.match(source.sourceHotspot.industryProfile.primaryIndustry, /新能源/);
      assert.match(system, /共同机制→行业标签→用户价值/);
      associationInputs.push(source.sourceHotspot.industryProfile);
      // 模拟兼容模型只返回风格卡、未返回发布正文，验证字段缺省路径。
      content = JSON.stringify({ title: '热点图文桌面验收', tags: ['续航'], styleCard: { palette: '蓝灰', layout: '实景留白', typography: '清晰中文', elements: '汽车', mood: '理性科普' }, notices: ['行业关联：续航热点→实际工况→新能源汽车→车主理解续航→用车科普；属于科普角度，不代表事件使用过本公司产品。'], pages: [
      { id: '', text: '续航应该怎么看', visual: '日常汽车使用场景', referenceIds: [] },
      { id: '', text: '结合实际工况判断', visual: '驾驶场景与简洁图文', referenceIds: [] },
    ] });
    } else content = '【分镜脚本总览】共1个镜头，总时长18秒\n【镜头1 | 0-18秒】\n▪️人员动作分工：出镜人员介绍实际用车场景\n▪️运镜与拍摄执行标准：近景平视\n▪️声音内容：结合实际工况理解续航表现';
    response.writeHead(200, { 'Content-Type': stream ? 'text/event-stream' : 'application/json' });
    response.end(stream ? 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\ndata: [DONE]\n\n' : JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const evaluate = expression => window.webContents.executeJavaScript(expression).catch(error => { throw new Error('热点桌面验收脚本失败：' + expression, { cause: error }); });
  const click = text => evaluate('Array.from(document.querySelectorAll("button")).find(el => el.textContent.trim() === ' + JSON.stringify(text) + ').click()');
  const nav = label => evaluate('document.querySelector(' + JSON.stringify('nav button[aria-label="' + label + '"]') + ').click()');
  try {
    LocalProviderService.prototype.read = function () { return { ...originalRead.call(this), llmApiKey: 'fixture-key', llmBaseUrl: url, llmModel: 'fixture', agnesApiKey: 'fixture-key', imageProtocol: 'agnes', imageEndpoint: 'https://apihub.agnes-ai.com/v1/images/generations' }; };
    globalThis.fetch = (input, init) => {
      const target = String(input);
      if (target.startsWith('https://uapis.cn/api/v1/misc/hotboard?')) {
        requests++; const platform = new URL(target).searchParams.get('type');
        return Promise.resolve(Response.json({ type: platform, update_time: new Date(Date.now() - (platform === 'xiaohongshu' ? 14 * 86400000 : 60000)).toISOString(),
          list: [{ index: 1, title, hot_value: '12345', url: platform === 'zhihu' ? 'https://www.zhihu.com/question/123456' : undefined }, { index: 2, title: unrelatedTitle, hot_value: '99999' }] }));
      }
      if (target === 'https://apihub.agnes-ai.com/v1/images/generations') {
        images++; const [w, h] = JSON.parse(init.body).ratio.split(':').map(Number);
        const output = nativeImage.createFromBitmap(Buffer.alloc(w * 16 * h * 16 * 4, 220), { width: w * 16, height: h * 16 }).toPNG();
        return Promise.resolve(Response.json({ data: [{ b64_json: output.toString('base64') }] }));
      }
      return originalFetch(input, init);
    };
    await nav('二创工作台');
    await waitFor(window, 'Boolean(document.querySelector("[data-testid=editable-transcript]"))');
    await evaluate('{ const el=document.querySelector("[data-testid=editable-transcript]");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,"热点转入前保留稿");el.dispatchEvent(new Event("input",{bubbles:true})); }');
    await nav('行业热点');
    await waitFor(window, 'Boolean(document.querySelector("[aria-label=热点平台筛选]"))');
    await click('全部');
    await waitFor(window, 'document.querySelectorAll("[data-testid=hotspot-card]").length === ' + availablePlatformCount * 2);
    assert.equal(await evaluate('document.querySelector("[aria-label=热榜数据来源]").innerText.includes("来源过期")'), true);
    assert.equal(await evaluate('document.querySelector("[aria-label=热榜数据来源]").textContent.includes("上游榜单超过 24 小时未更新")'), true);
    assert.equal(await evaluate('document.querySelectorAll("[aria-label=热榜数据来源] details[open]").length'), 0);
    assert.equal(await evaluate('document.querySelectorAll("[data-testid=platform-source-legend] button").length'), platforms.length);
    const chart = await evaluate('(() => { const svg=document.querySelector("[aria-label=热榜数据来源] svg"); const arcs=Array.from(svg.querySelectorAll("[role=button]")); return {label:svg.getAttribute("aria-label"),arcs:arcs.length,finite:arcs.every(arc=>!/NaN|Infinity/.test(arc.getAttribute("stroke-dasharray"))),totalLength:arcs.reduce((sum,arc)=>sum+Number(arc.getAttribute("stroke-dasharray").split(" ")[0]),0),unavailableArc:arcs.some(arc=>arc.getAttribute("aria-label").startsWith("视频号"))}; })()');
    assert.equal(chart.label, '平台数据占比，共 ' + availablePlatformCount * 2 + ' 条');
    assert.equal(chart.arcs, availablePlatformCount); assert.ok(chart.finite); assert.ok(Math.abs(chart.totalLength - 2 * Math.PI * 38) < 0.001); assert.equal(chart.unavailableArc, false);
    await evaluate('document.querySelector("[aria-label=热榜数据来源] svg [role=button]").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
    await waitFor(window, 'document.querySelector("[data-testid=platform-source-legend] [data-platform=douyin]").getAttribute("aria-pressed") === "true" && document.querySelectorAll("[data-testid=hotspot-card]").length === 2');
    await evaluate('document.querySelector("[data-testid=platform-source-legend] [data-platform=weibo]").click()');
    await waitFor(window, 'document.querySelector("[aria-label=热点平台筛选] [aria-pressed=true]")?.textContent === "微博"');
    await click('全部');
    if (platforms.includes('wechat_channels')) {
      const beforeVideoChannel = requests;
      await click('视频号');
      await waitFor(window, 'document.querySelector("[aria-label=热点平台筛选] button[aria-pressed=true]")?.textContent === "视频号" && document.querySelectorAll("[data-testid=hotspot-card]").length === 0');
      assert.equal(await evaluate('document.body.innerText.includes("当前数据源不支持视频号热榜")'), true);
      assert.equal(requests, beforeVideoChannel);
      fs.writeFileSync(path.join(outputDirectory, 'wechat-channels-unavailable.png'), (await window.capturePage()).toPNG());
      await click('全部');
    }
    if (platforms.includes('toutiao')) {
      await click('今日头条');
      await waitFor(window, 'document.querySelectorAll("[data-testid=hotspot-card]").length === 2 && document.querySelector("[data-testid=hotspot-card]").textContent.includes("今日头条")');
      fs.writeFileSync(path.join(outputDirectory, 'toutiao-board.png'), (await window.capturePage()).toPNG());
      await click('全部');
    }
    const beforePreset = requests;
    await evaluate('{ const el=document.querySelector("#trending-template");el.value="health";el.dispatchEvent(new Event("change",{bubbles:true})); }');
    await waitFor(window, 'document.body.innerText.includes("没有符合条件的话题") && document.querySelectorAll("[data-testid=hotspot-card]").length === 0');
    assert.equal(requests, beforePreset + availablePlatformCount);
    assert.equal(await evaluate('document.querySelector("#trending-template").value'), 'health');
    await evaluate('{ const el=document.querySelector("#trending-template");el.value="new_energy";el.dispatchEvent(new Event("change",{bubbles:true})); }');
    await waitFor(window, 'document.querySelector("[data-testid=hotspot-card]")?.textContent.includes("AI 匹配分 90")');
    assert.equal(requests, beforePreset + availablePlatformCount * 2);
    assert.equal(await evaluate('document.querySelector("#trending-template").value'), 'new_energy');
    assert.equal(await evaluate('document.querySelector("#trending-tag").closest("details").open'), false);
    await evaluate('document.querySelector("#trending-tag").closest("details").open = true');
    await evaluate('{ const el=document.querySelector("#trending-tag");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"自定义旧标签");el.dispatchEvent(new Event("input",{bubbles:true})); }');
    await evaluate('document.querySelector("button[aria-label=添加行业标签]").click()');
    await waitFor(window, 'document.querySelector("#trending-template").value === "" && document.querySelector("#trending-template").selectedOptions[0].textContent === "自定义行业"');
    await evaluate('{ const el=document.querySelector("#trending-template");el.value="new_energy";el.dispatchEvent(new Event("change",{bubbles:true})); }');
    await waitFor(window, 'document.querySelector("[data-testid=hotspot-card]")?.textContent.includes("AI 匹配分 90")');
    assert.equal(await evaluate('document.querySelector("#trending-tag").closest("details").open'), false);
    assert.equal(await evaluate('document.querySelector("[aria-label=行业画像]").textContent.includes("自定义旧标签")'), false);
    const count = requests; await click('刷新热榜');
    await waitFor(window, 'Array.from(document.querySelectorAll("button")).some(el => el.textContent.trim() === "刷新热榜" && !el.disabled)');
    assert.equal(requests, count + availablePlatformCount);
    assert.equal(await evaluate('Array.from(document.querySelectorAll("[aria-label=热点平台筛选] button")).find(button => button.textContent.trim() === "行业推荐")?.getAttribute("aria-pressed")'), 'true');
    assert.equal(await evaluate('document.querySelectorAll("[data-testid=hotspot-card]").length'), availablePlatformCount - 1);
    assert.equal(await evaluate('Array.from(document.querySelectorAll("[data-testid=hotspot-card]")).some(card => card.textContent.includes("明星演唱会"))'), false);
    assert.ok(rankedTitles.length > 0 && rankedTitles.every(value => value === title));
    for (const [width, columns] of [[1366, 3], [1280, 3], [1024, 3], [900, 2], [768, 2], [640, 1], [390, 1], [375, 1], [1366, 3]]) {
      window.setOpacity(0); window.showInactive(); window.setContentSize(width, 900);
      await waitFor(window, 'Math.abs(innerWidth - ' + width + ') <= 1');
      await new Promise(resolve => setTimeout(resolve, 180));
      const layout = await evaluate('(() => { const grid=document.querySelector("[data-testid=trending-results]"); const cards=Array.from(grid.children).map(card => { const r=card.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right}; }); return {width:innerWidth,columns:getComputedStyle(grid).gridTemplateColumns.split(" ").length,cards,noOverflow:document.documentElement.scrollWidth <= innerWidth}; })()');
      const sources = await evaluate('(() => { const section=document.querySelector("[aria-label=热榜数据来源]"); const legend=section.querySelector("[data-testid=platform-source-legend]"); const entries=Array.from(legend.children).map(entry => { const r=entry.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,height:r.height,noOverflow:entry.scrollWidth<=entry.clientWidth+1}; }); const select=document.querySelector("#trending-template").getBoundingClientRect(); const buttons=Array.from(document.querySelectorAll("button")).filter(button => button.textContent.trim() === "全部"); const all=buttons[0].getBoundingClientRect(); return {columns:getComputedStyle(legend).gridTemplateColumns.split(" ").length,entries,allCount:buttons.length,allOnLeft:all.right<=select.x && Math.abs(all.y-select.y)<1,allPressed:buttons[0].getAttribute("aria-pressed")}; })()');
      const sourceColumns = width >= 1280 ? 3 : width >= 1024 ? 2 : width >= 640 ? 3 : 2;
      assert.equal(sources.columns, sourceColumns); assert.equal(sources.allCount, 1); assert.ok(sources.allOnLeft, JSON.stringify({width,sources}));
      assert.ok(sources.entries.every(entry => entry.noOverflow && entry.x >= 0 && entry.right <= layout.width + 1), JSON.stringify({width,sources}));
      assert.ok(sources.entries.slice(0,sourceColumns).every(entry => Math.abs(entry.y-sources.entries[0].y)<1), JSON.stringify({width,sources}));
      layout.sources = sources;
      assert.equal(layout.columns, columns); assert.ok(layout.noOverflow, JSON.stringify(layout));
      if (columns === 3) assert.ok(layout.cards.slice(0,3).every(card => Math.abs(card.y-layout.cards[0].y)<1) && layout.cards[1].x>layout.cards[0].x && layout.cards[2].x>layout.cards[1].x);
      const actions = await evaluate('Array.from(document.querySelectorAll("[data-testid=hotspot-actions]")).map(row => { const r=row.getBoundingClientRect(); const buttons=Array.from(row.children).map(button => { const b=button.getBoundingClientRect(); return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,text:button.textContent,client:button.clientWidth,scroll:button.scrollWidth}; }); return {left:r.left,right:r.right,buttons}; })');
      for (const row of actions) {
        assert.equal(row.buttons.length, 3);
        assert.ok(row.buttons.every(button => Math.abs(button.y-row.buttons[0].y)<1 && button.x>=row.left-1 && button.right<=row.right+1 && button.scroll<=button.client+1), JSON.stringify({width,row}));
      }
      layout.requestedWidth = width;
      layout.actionsOnOneRow = true;
      if (width === 375 || width === 1024) fs.writeFileSync(path.join(outputDirectory, 'hotspot-actions-' + width + '.png'), (await window.capturePage()).toPNG());
      layouts.push(layout);
    }
    const detailsLayout = await evaluate('(() => { const section=document.querySelector("[aria-label=热榜数据来源]"); const detail=section.querySelector("details"); const legend=section.querySelector("[data-testid=platform-source-legend]"); const before=legend.getBoundingClientRect().height; detail.querySelector("summary").click(); return {open:detail.open,reasonVisible:detail.innerText.includes("上游榜单超过 24 小时未更新"),sourceNameAndTime:detail.innerText.includes("更新："),legendHeightUnchanged:legend.getBoundingClientRect().height===before}; })()');
    assert.ok(Object.values(detailsLayout).every(Boolean), JSON.stringify(detailsLayout));
    fs.writeFileSync(path.join(outputDirectory, 'source-details-expanded.png'), (await window.capturePage()).toPNG());
    await evaluate('document.querySelector("[aria-label=热榜数据来源] details[open]").querySelector("summary").click()');
    await click('全部');
    assert.equal(await evaluate('Array.from(document.querySelectorAll("header button")).find(button=>button.textContent.trim()==="全部").getAttribute("aria-pressed")'), 'true');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>resolve(true),160))))');
    const pressedStyle = await evaluate('(() => { const selected=Array.from(document.querySelectorAll("header button")).find(button=>button.textContent.trim()==="全部"); const unselected=document.querySelector("[aria-label=热点平台筛选] button"); return {selected:getComputedStyle(selected).backgroundColor,unselected:getComputedStyle(unselected).backgroundColor,weight:getComputedStyle(selected).fontWeight}; })()');
    assert.notEqual(pressedStyle.selected, pressedStyle.unselected); assert.ok(Number(pressedStyle.weight) >= 600);
    fs.writeFileSync(path.join(outputDirectory, 'trending-board-' + version + '.png'), (await window.capturePage()).toPNG());
    await click(transferPlatformLabel);
    await waitFor(window, 'document.querySelectorAll("[data-testid=hotspot-card]").length === 2');
    await click('转视频二创'); await waitFor(window, 'Boolean(document.querySelector("[role=dialog]"))');
    await click('取消'); await nav('二创工作台');
    assert.equal(await evaluate('document.querySelector("[data-testid=editable-transcript]").value'), '热点转入前保留稿');
    await nav('行业热点'); await click('转视频二创');
    await waitFor(window, 'Boolean(document.querySelector("[role=dialog]"))'); await click('放弃当前稿并转入');
    await waitFor(window, 'document.querySelector("[data-testid=editable-transcript]")?.value.includes("热点桌面验收")');
    assert.equal(await evaluate('document.body.innerText.includes(' + JSON.stringify(transferPlatformLabel + '热点话题') + ')'), true);
    await evaluate('document.querySelector("[data-testid=generate-script]").click()');
    await waitFor(window, 'window.electronAPI.listHistoryFromDB().then(r=>r.records.some(v=>v.sourceContent?.sourceHotspot?.title === ' + JSON.stringify(title) + '))');
    const video = (await call('listHistoryFromDB')).records.find(record => record.sourceContent?.sourceHotspot?.title === title);
    assert.equal(video.platform, transferPlatform); assert.equal(video.sourceContent.sourceHotspot.platform, transferPlatform);
    assert.match(video.sourceContent.sourceHotspot.industryProfile.primaryIndustry, /新能源/);
    assert.match(video.conversationMessages[0].content, /共同机制→行业标签→用户价值/);
    await nav('行业热点'); await click('转图文策划');
    await waitFor(window, 'Boolean(document.querySelector("[role=dialog]")) || Array.from(document.querySelectorAll("textarea,input")).some(el => el.value === "热点图文桌面验收")');
    if (await evaluate('Boolean(document.querySelector("[role=dialog]"))')) await click('放弃当前稿并转入');
    await waitFor(window, 'window.electronAPI.listImageTextHistory().then(r=>r.data.some(d=>d.source.sourceHotspot?.title === ' + JSON.stringify(title) + '))');
    assert.equal(images, 0);
    assert.equal(await evaluate('document.querySelector("[data-testid=image-text-plan-notices]").textContent.includes("本次策划未提供发布正文、整套风格")'), true);
    assert.equal(await evaluate('document.querySelector("[data-testid=image-text-plan-notices]").open'), false);
    await waitFor(window, 'Array.from(document.querySelectorAll("button")).some(el=>el.textContent.trim() === "确认文案、张数及比例，开始生成 2 张图片" && !el.disabled)');
    await click('确认文案、张数及比例，开始生成 2 张图片');
    await waitFor(window, 'window.electronAPI.listImageTextHistory().then(r=>r.data.some(d=>d.source.sourceHotspot?.title === ' + JSON.stringify(title) + ' && d.pages.length === 2 && d.pages.every(p=>p.assetId)))');
    assert.equal(images, 2);
    const image = (await call('listImageTextHistory')).data.find(draft => draft.source.sourceHotspot?.title === title);
    assert.equal(image.source.platform, transferPlatform); assert.equal(image.confirmed, true); assert.equal(image.title, '热点图文桌面验收');
    const totalBeforeFilter = (await call('getDatabaseInfo')).info.totalCount;
    await waitFor(window, 'document.querySelector("nav button[aria-label=历史记录]").textContent.trim() === ' + JSON.stringify('历史记录' + totalBeforeFilter));
    await nav('历史记录'); await waitFor(window, 'Boolean(document.querySelector("[data-testid=history-record]"))');
    await click(transferPlatformLabel); await waitFor(window, 'document.querySelectorAll("[data-testid=history-record]").length === 2');
    assert.equal(await evaluate('document.querySelector("nav button[aria-label=历史记录]").textContent.trim()'), '历史记录' + totalBeforeFilter);
    assert.equal(associationInputs.length, 1);
    await waitFor(window, 'document.querySelector("[aria-label=历史详情] .muted-copy")?.textContent.includes(' + JSON.stringify(transferPlatformLabel + '热点') + ')');
    await waitFor(window, 'Array.from(document.querySelectorAll("[aria-label=历史详情] img")).some(image => image.complete && image.naturalWidth > 0)');
    fs.writeFileSync(path.join(outputDirectory, 'trending-history-' + version + '.png'), (await window.capturePage()).toPNG());
    fs.writeFileSync(path.join(outputDirectory, 'trending-package-acceptance-' + version + '.json'), JSON.stringify({ version, passed: true,
      checkedAt: new Date().toISOString(), fixtureOnly: true, checks: ['平台来源状态', '宽屏六个平台同排及窄屏分列', '来源详情折叠且展开不拉高其他卡片', '全部按钮位于预设左侧且筛选正常', '过期数据标注', '视频号待接入状态不发起上游请求', 'AI 精排', '强制刷新', '推荐排除过期榜单', '视频草稿取消及替换', '视频生成和来源历史', '图文策划及确认前零生图', '确认后两张图片生成和保存', '今日头条视频及图文历史来源和平台筛选', '图文详情来源及图片显示', '预设自动进入行业推荐', '无关联话题空态', '无关热点不提交模型', '桌面三列及窄屏自适应', '当前预设及自定义行业显示', '标签编辑默认收起', '切换预设强制获取所有可用平台并替换旧标签', '375 至 1366 像素三个入口同一行', '图文省略body和style仍可策划并显示核对提示', '视频和图文保留行业快照及关联约束', '图文保存后数据库总数同步侧栏', '筛选后侧栏总数保持不变'], requests, images, layouts }, null, 2));
    console.log('行业热点打包验收通过：来源、过期、推荐、刷新、草稿保护、视频及图文完整生成和历史溯源。');
  } catch (error) {
    fs.writeFileSync(path.join(outputDirectory, 'trending-failure-' + version + '.json'), JSON.stringify({ error: error.message, view: await evaluate('document.body.innerText') }, null, 2));
    throw error;
  } finally {
    window.hide(); globalThis.fetch = originalFetch; LocalProviderService.prototype.read = originalRead;
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    for (const record of (await call('listHistoryFromDB')).records) if (!beforeVideo.has(record.id)) await call('deleteHistoryFromDB', record.id);
    for (const record of (await call('listImageTextHistory')).data) if (!beforeImage.has(record.id)) await call('deleteImageTextHistory', record.id);
  }
};
