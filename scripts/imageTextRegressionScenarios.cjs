const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {dialog} = require('electron');

module.exports = async function verifyImageTextFixes({window,call,waitFor,clickText,setLabel,imageHistory,baseline,dataDirectory,referenceFile,applicationPath,providerClass,databaseClass,baseURL,imageCalls,evidenceDirectory=path.join(applicationPath,'docs','图文流程排查证据','2026-10-30-回归')}) {
  fs.mkdirSync(evidenceDirectory,{recursive:true});
  const results=[];
  const record=(id,details)=>{results.push({id,status:'PASS',details});fs.writeFileSync(path.join(evidenceDirectory,'regression.json'),JSON.stringify({date:'2026-10-30',version:require(path.join(applicationPath,'package.json')).version,packaged:applicationPath.endsWith('.asar'),supplier:'isolated fixtures',cases:results},null,2),'utf8');console.log('缺陷回归 '+id+' PASS '+JSON.stringify(details));};
  const nav=label=>window.webContents.executeJavaScript('Array.from(document.querySelectorAll("nav button")).find(el=>el.getAttribute("aria-label")==='+JSON.stringify(label)+').click()');
  const openDraft=async(seed,title)=>{
    seed=structuredClone(seed);seed.title=title;
    assert.equal((await call('saveImageTextHistory',seed)).success,true);
    await nav('设置');await waitFor(window,'Boolean(document.querySelector("[aria-label=设置分类]"))');await nav('历史记录');
    await waitFor(window,'Array.from(document.querySelectorAll("[data-testid=history-record]")).some(el=>el.dataset.recordId==='+JSON.stringify(seed.id)+'&&el.textContent.includes('+JSON.stringify(title)+'))');
    await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[data-testid=history-record]")).find(el=>el.dataset.recordId==='+JSON.stringify(seed.id)+').click()');await clickText('重新编辑');
    if(await window.webContents.executeJavaScript('document.querySelector("[role=dialog]")?.textContent.includes("未保存修改")'))await clickText('放弃修改并打开');
    await waitFor(window,seed.confirmed ? 'document.querySelector("[data-testid=image-text-title]")?.value==='+JSON.stringify(title) : 'Array.from(document.querySelectorAll("[aria-label=图文策划与确认] label")).find(el=>el.firstChild?.textContent==="发布标题")?.querySelector("textarea").value==='+JSON.stringify(title));
    await window.webContents.executeJavaScript('document.querySelectorAll("button[aria-label=关闭提示]").forEach(el=>el.click())');
    await waitFor(window,'!document.querySelector("button[aria-label=关闭提示]")');return seed;
  };
  const current=async()=> (await imageHistory()).find(d=>d.id===baseline.id);
  const idle=()=>waitFor(window,'!Array.from(document.querySelectorAll("button")).some(el=>el.textContent.trim()==="取消任务")');
  const originalFetch=globalThis.fetch;const originalDialog=dialog.showOpenDialog;const originalRead=providerClass.prototype.read;const originalSave=databaseClass.prototype.saveImageTextRecord;
  const url='https://apihub.agnes-ai.com/v1/images/generations';
  try {
    // F02：模型返回前不允许编辑正文、比例、风格卡和分页结构。
    await openDraft(baseline,'F02 预览保护');let releasePlan;let reached=false;
    const gate=new Promise(resolve=>{releasePlan=resolve;});
    globalThis.fetch=async(input,init)=>{if(String(input).startsWith(baseURL)&&typeof init?.body==='string'&&JSON.parse(init.body).messages?.[0]?.content?.includes('小红书图文策划师')){reached=true;await gate;}return originalFetch(input,init);};
    await clickText('全局优化');await waitFor(window,'Boolean(document.querySelector("[role=dialog] fieldset"))');
    await setLabel('配套发布正文','F02 预览前人工正文');await setLabel('全局优化指令（可选，填写后调用文本模型重新策划）','保持主题');await clickText('生成优化预览');
    const deadline=Date.now()+3000;while(!reached&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(reached);
    const locked=await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[role=dialog] textarea,[role=dialog] select,[role=dialog] fieldset button")).every(el=>el.matches(":disabled"))');assert.ok(locked);
    releasePlan();await waitFor(window,'Array.from(document.querySelectorAll("button")).some(el=>["应用全局优化","仅更新文案"].includes(el.textContent.trim())&&!el.disabled)');
    const body=await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[role=dialog] label")).find(el=>el.firstChild?.textContent==="配套发布正文").querySelector("textarea").value');
    assert.equal(body,'F02 预览前人工正文');await clickText('取消');await waitFor(window,'!document.querySelector("[role=dialog] fieldset")');globalThis.fetch=originalFetch;
    record('F02',{editingLockedDuringPreview:locked,submittedManualBodyRetained:true});

    // F01：失败保留旧图，但当前改稿不能沿用已核对状态，实际报错可见，自动核对留存日志和导出清单。
    await openDraft(baseline,'F01 失败旧图提醒');
    await window.webContents.executeJavaScript('document.querySelector("select[aria-label=选择图片]").selectedIndex=0;document.querySelector("select[aria-label=选择图片]").dispatchEvent(new Event("change",{bubbles:true}));');
    await window.webContents.executeJavaScript('document.querySelector("[aria-label=图文结果] input[type=checkbox]").click()');
    await waitFor(window,'window.electronAPI.listImageTextHistory().then(r=>!!r.data.find(d=>d.id==='+JSON.stringify(baseline.id)+').pages[0].reviewedVersionId)');
    globalThis.fetch=(input,init)=>String(input)===url?Promise.resolve(Response.json({}, {status:503})):originalFetch(input,init);
    await clickText('图片优化');await waitFor(window,'Boolean(document.querySelector("[role=dialog] fieldset"))');await setLabel('本图文字','F01 需要重生成的新文字');await clickText('优化并重生成本图');
    await waitFor(window,'document.body.innerText.includes("HTTP 503")');await idle();
    const failed=await current();assert.equal(failed.pages[0].assetId,baseline.pages[0].assetId);assert.equal(failed.pages[0].reviewedVersionId,undefined);
    const reviewControl=await window.webContents.executeJavaScript('(()=>{const el=document.querySelector("[aria-label=图文结果] input[type=checkbox]");return {checked:el.checked,disabled:el.disabled};})()');assert.deepEqual(reviewControl,{checked:false,disabled:true});
    assert.ok(await window.webContents.executeJavaScript('(()=>{const el=document.querySelector("[aria-label=图文结果] [role=alert]");return !!el&&!el.closest("details")&&Array.from(document.querySelectorAll("[aria-label=图文结果] details")).some(el=>el.querySelector("summary").textContent==="本图文字与画面要求"&&el.open);})()'));
    assert.equal(await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[aria-label=图文编辑分页] [role=tab]")).some(el=>/核对|概览/.test(el.textContent))'),false);
    const parent=path.join(dataDirectory,'fixed-export');fs.mkdirSync(parent);dialog.showOpenDialog=async()=>({canceled:false,filePaths:[parent]});await clickText('导出素材包');
    await waitFor(window,'document.body.innerText.includes("素材包已导出到")');
    const output=path.join(parent,fs.readdirSync(parent)[0]);const checklist=fs.readFileSync(path.join(output,'内部核对.txt'),'utf8');
    assert.match(checklist,/第 1 图仍为旧图，内容不同步/);assert.match(checklist,/第 1 图生成失败/);assert.match(checklist,/第 1 图：图内文字尚未人工核对/);
    fs.writeFileSync(path.join(evidenceDirectory,'F01-内部核对.txt'),checklist,'utf8');
    await window.webContents.executeJavaScript('document.querySelector("[aria-label=图文结果] input[type=checkbox]").scrollIntoView({block:"center"})');
    window.setOpacity(0);window.showInactive();
    await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    await new Promise(resolve=>setTimeout(resolve,160));fs.writeFileSync(path.join(evidenceDirectory,'F01-旧图失配提醒.png'),(await window.webContents.capturePage()).toPNG());window.hide();
    record('F01',{oldImageRetained:true,currentReviewCleared:true,reviewDisabled:true,exportWarnsStaleAndFailed:true,exportStillAllowed:true});globalThis.fetch=originalFetch;

    // F03：满额时移除一个素材可立即再次导入，历史版本和移除素材仍可读。
    await openDraft(baseline,'F03 满额素材释放');const files=[];
    for(let i=0;i<29;i++){const file=path.join(dataDirectory,'fixed-scene-'+i+'.png');fs.copyFileSync(referenceFile,file);files.push(file);}
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});await clickText('图片优化');await waitFor(window,'Boolean(document.querySelector("[role=dialog] fieldset"))');await clickText('为本图补传实际场景图（可选）');await waitFor(window,'document.querySelector("[role=dialog]")?.textContent.includes("fixed-scene-28.png")');
    await clickText('取消');await waitFor(window,'!document.querySelector("[role=dialog] fieldset")');const full=await current();assert.equal(full.references.length,30);
    const removed=full.references[0];await clickText('图片优化');await waitFor(window,'Boolean(document.querySelector("[role=dialog] fieldset"))');
    await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[role=dialog] button")).find(el=>el.getAttribute("aria-label")==='+JSON.stringify('移除参考图 '+removed.name)+').click()');
    await waitFor(window,'window.electronAPI.listImageTextHistory().then(r=>r.data.find(d=>d.id==='+JSON.stringify(baseline.id)+').references.length===29)');
    await waitFor(window,'Array.from(document.querySelectorAll("button")).some(el=>el.textContent.trim()==="为本图补传实际场景图（可选）"&&!el.disabled)');
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[referenceFile]});await clickText('为本图补传实际场景图（可选）');
    await waitFor(window,'window.electronAPI.listImageTextHistory().then(r=>r.data.find(d=>d.id==='+JSON.stringify(baseline.id)+').references.length===30)');
    await waitFor(window,'Array.from(document.querySelectorAll("[role=dialog] button")).some(el=>el.textContent.trim()==="取消"&&!el.disabled)');await clickText('取消');await waitFor(window,'!document.querySelector("[role=dialog] fieldset")');
    const replaced=await current();assert.equal(replaced.references.length,30);assert.ok(replaced.archivedReferences.some(ref=>ref.id===removed.id));assert.deepEqual(replaced.versions,full.versions);assert.equal((await call('readImageTextAsset',removed.id)).success,true);
    const deletion=await call('getImageTextDeletionInfo',replaced.id);assert.ok(deletion.data.count>=37);
    record('F03',{activeReferences:30,archivedReferences:replaced.archivedReferences.length,newUploadAfterRemoval:true,oldVersionsRetained:true,archivedAssetReadable:true,archivedAssetIncludedInDeletion:true});

    // F04：取消保留修改，保存后打开保留最新稿，明确放弃才回到历史稿。
    const editable={...structuredClone(baseline),confirmed:false};await openDraft(editable,'F04 未保存保护');
    const manualBody='F04 需要保留的人工修改';await setLabel('配套发布正文',manualBody);
    const reopenHistory=async()=>{await nav('历史记录');await waitFor(window,'Boolean(document.querySelector("[data-testid=history-record]"))');await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("[data-testid=history-record]")).find(el=>el.dataset.recordId==='+JSON.stringify(baseline.id)+').click()');await clickText('重新编辑');await waitFor(window,'document.querySelector("[role=dialog]")?.textContent.includes("未保存修改")');};
    const readBody=()=>window.webContents.executeJavaScript('Array.from(document.querySelectorAll("label")).find(el=>el.firstChild?.textContent==="配套发布正文").querySelector("textarea").value');
    await reopenHistory();await clickText('取消');await nav('小红书图文');await waitFor(window,'Boolean(document.querySelector("[aria-label=图文策划与确认]"))');assert.equal(await readBody(),manualBody);
    await reopenHistory();databaseClass.prototype.saveImageTextRecord=async()=>{throw new Error('F04 测试磁盘写入失败');};
    await clickText('保存修改并打开');await waitFor(window,'document.querySelector("[role=dialog] [role=alert]")?.textContent.includes("F04 测试磁盘写入失败")');
    assert.ok(await window.webContents.executeJavaScript('document.querySelector("[role=dialog]")?.textContent.includes("未保存修改")'));
    databaseClass.prototype.saveImageTextRecord=originalSave;await clickText('取消');await nav('小红书图文');await waitFor(window,'Boolean(document.querySelector("[aria-label=图文策划与确认]"))');assert.equal(await readBody(),manualBody);
    await reopenHistory();await clickText('保存修改并打开');await waitFor(window,'Boolean(document.querySelector("[aria-label=图文策划与确认]"))');assert.equal(await readBody(),manualBody);assert.equal((await current()).body,manualBody);
    await setLabel('配套发布正文','F04 明确放弃的修改');await reopenHistory();await clickText('放弃修改并打开');await waitFor(window,'Boolean(document.querySelector("[aria-label=图文策划与确认]"))');assert.equal(await readBody(),manualBody);
    record('F04',{guardShown:true,cancelPreservesEdits:true,saveFailurePreservesEdits:true,savePreservesEdits:true,explicitDiscardWorks:true});

    // F05：供应商全局错误第一次出现即停止；503 单页故障仍可继续其他页。
    for(const [status,expected] of [[401,'AGNES_AUTH'],[402,'AGNES_QUOTA'],[429,'AGNES_RATE_LIMIT']]){
      const seed=structuredClone(baseline);seed.pages=seed.pages.map(p=>({...p,text:p.text+' F05 '+status}));await openDraft(seed,'F05 全局错误 '+status);let requests=0;
      globalThis.fetch=(input,init)=>{if(String(input)===url){requests++;return Promise.resolve(Response.json({}, {status}));}return originalFetch(input,init);};
      const protocol=await call('generateImageText',{draft:seed,pageId:seed.pages[0].id,taskId:'f05-protocol-'+status});assert.equal(protocol.errorCode,expected);requests=0;
      await clickText('继续／重试 2 张未完成图片');await waitFor(window,'document.body.innerText.includes("已停止后续生图")');await idle();assert.equal(requests,1);
      globalThis.fetch=originalFetch;const before=imageCalls();await clickText('继续／重试 2 张未完成图片');
      await waitFor(window,'window.electronAPI.listImageTextHistory().then(r=>r.data.find(d=>d.id==='+JSON.stringify(baseline.id)+').pages.every(p=>!p.error&&JSON.parse(p.renderedKey).text===p.text&&p.text.includes("F05 '+status+'")))');await idle();assert.equal(imageCalls()-before,2);
      record('F05-'+status,{errorCode:protocol.errorCode,requestsBeforeStop:requests,retryAfterRecovery:2});
    }
    await openDraft(baseline,'修复回归完成');
    record('complete',{allFiveFindingsFixed:true,commercialCalls:0,productionDataAccessed:false});
  } finally {globalThis.fetch=originalFetch;dialog.showOpenDialog=originalDialog;providerClass.prototype.read=originalRead;databaseClass.prototype.saveImageTextRecord=originalSave;}
};
