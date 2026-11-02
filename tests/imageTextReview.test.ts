import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendPageVersion, editImageTextStructure, imageTextChecks, internalImageTextChecklist, optimizationImpact, selectPageVersion, verifyImageEvidence } from '../electron/services/imageTextReview';
import { affectedPages, pageRenderKey } from '../electron/services/imageTextModel';
import { imageTextFixture } from './helpers/imageTextFixture';

test('风格卡按结构参与比较；排序不影响图片，新增删除正确计算范围', () => {
  let d = imageTextFixture(); d.styleCard = {palette:'暖色',layout:'留白',typography:'无衬线',elements:'实景',mood:'轻松'};
  d.pages.forEach(p => p.renderedKey = pageRenderKey(d,p));
  d = editImageTextStructure(d,'down','page-one',() => 'new-page'); assert.deepEqual(optimizationImpact(d),[]);
  d.style = '不影响生图的显示摘要'; assert.deepEqual(affectedPages(d),[]);
  d.styleCard = {...d.styleCard!,palette:'冷色'}; assert.equal(optimizationImpact(d).length,2);
  d = editImageTextStructure(d,'add','',() => 'new-page'); assert.equal(optimizationImpact(d).length,3);
  d = editImageTextStructure(d,'delete','new-page',() => 'unused'); assert.equal(d.pages.length,2);
});
test('所有成功版本保留，切回旧版不生图且清除核对标记，删除页不删版本', () => {
  let d = imageTextFixture(); let n=0;
  d = appendPageVersion(d,'page-one',{assetId:'new-one',renderedKey:pageRenderKey(d,d.pages[0])},() => 'v-'+(++n));
  assert.equal(d.versions!.length,2);
  const old=d.versions![0];
  d.pages[0].reviewedVersionId=d.pages[0].currentVersionId;
  d = selectPageVersion(d,'page-one',old.id);
  assert.equal(d.pages[0].assetId,'old-one'); assert.equal(d.pages[0].reviewedVersionId,undefined);
  assert.equal(d.pages[1].assetId,'old-two'); assert.equal(affectedPages(d).length,0);
  d = editImageTextStructure(d,'delete','page-one',() => 'unused'); assert.equal(d.versions!.length,2);
});
test('依据去空白核对，区分停用文档和改写片段；自查仅提醒且字数上限可空', () => {
  const d=imageTextFixture();d.evidence=[{documentId:'kb',quote:'规格 100 ml',claim:'容量100ml'}, {documentId:'disabled',quote:'价格',claim:'价格'}, {documentId:'kb',quote:'不存在',claim:'其他'}];
  const docs=[{id:'kb',enabled:true,fullContent:'规格100ml，准确参数。'},{id:'disabled',enabled:false,fullContent:'价格'}];
  assert.deepEqual(verifyImageEvidence(d,docs).map(e=>e.status),['已核实','文档已停用或不存在','原文未找到']);
  d.body='禁用词与待确认';
  const checks=imageTextChecks(d,['禁用词']);
  assert.equal(checks.find(c=>c.id==='forbidden')!.passed,false); assert.equal(checks.find(c=>c.id==='placeholder')!.passed,false);
  assert.match(checks.find(c=>c.id==='title')!.detail,/未提供/);
  assert.equal(imageTextChecks(d,[],{title:1}).find(c=>c.id==='title')!.passed,false);
  const internal=internalImageTextChecklist(d,docs,['禁用词']);assert.match(internal,/尚未人工核对/);assert.match(internal,/规格 100 ml/);
});
test('复制拆分合并分配稳定标识并保留不相关页和历史版本', () => {
  let d=imageTextFixture();let n=0;
  d=editImageTextStructure(d,'copy','page-one',()=> 'copy-'+(++n));assert.equal(d.pages[1].assetId,undefined);assert.equal(d.pages[2].id,'page-two');
  d=editImageTextStructure(d,'split','page-one',()=> 'split-'+(++n));assert.equal(d.pages[0].id,'page-one');assert.equal(d.pages[1].assetId,undefined);
  d=editImageTextStructure(d,'merge','page-one',()=> 'unused');assert.equal(d.pages[0].id,'page-one');assert.equal(d.pages.at(-1)!.id,'page-two');
});

test('风格卡字段排列顺序不影响指纹，当前页的参考标识排序不触发生图',()=>{
  const d=imageTextFixture();d.styleCard={palette:'暖',layout:'留白',typography:'宋',elements:'实景',mood:'轻松'};
  const before=pageRenderKey(d,d.pages[0]);
  d.styleCard={mood:'轻松',elements:'实景',typography:'宋',layout:'留白',palette:'暖'};
  assert.equal(pageRenderKey(d,d.pages[0]),before);
});

test('F01 当前草稿与旧图失配及生成失败必须进入自查和导出清单', async () => {
  const { isImagePageReviewed } = await import('../electron/services/imageTextReview');
  const draft = imageTextFixture();
  draft.pages[0].currentVersionId = 'reviewed-version'; draft.pages[0].reviewedVersionId = 'reviewed-version';
  assert.equal(isImagePageReviewed(draft,draft.pages[0]),true);
  draft.pages[0].text = '需要重生成的新文字'; draft.pages[0].error = 'HTTP 503';
  assert.equal(isImagePageReviewed(draft,draft.pages[0]),false);
  const checks = imageTextChecks(draft,[]);
  assert.equal(checks.find(c => c.id === 'current')!.passed,false);
  assert.equal(checks.find(c => c.id === 'generation')!.passed,false);
  const checklist = internalImageTextChecklist(draft,[],[]);
  assert.match(checklist,/第 1 图仍为旧图，内容不同步/);
  assert.match(checklist,/第 1 图生成失败/); assert.match(checklist,/第 1 图：图内文字尚未人工核对/);
});

test('F03 移除参考图释放名额，归档素材支持旧版本恢复且进入整条删除清单', async () => {
  const { removeImageReference } = await import('../electron/services/imageTextReview');
  const { assertImageTextDraft } = await import('../electron/services/imageTextModel');
  const { imageTextAssetIds } = await import('../electron/services/imageTextDeletion');
  let draft = imageTextFixture();
  draft.references = [{ id:'scene-reference',name:'场景',kind:'scene',width:100,height:100 }];
  draft.pages[0].referenceIds = ['scene-reference'];
  draft = appendPageVersion(draft,'page-one',{assetId:'version-image',renderedKey:pageRenderKey(draft,draft.pages[0])},()=>crypto.randomUUID());
  const version = draft.versions!.at(-1)!;
  const removed = removeImageReference(draft,'scene-reference');
  assert.equal(removed.references.length,0); assert.deepEqual(removed.pages[0].referenceIds,[]);
  assert.equal(removed.archivedReferences![0].id,'scene-reference'); assert.deepEqual(removed.versions,draft.versions);
  assert.ok(imageTextAssetIds(removed).includes('scene-reference'));
  removed.references = Array.from({length:30},(_,i)=>({id:'new-'+i,name:'新场景',kind:'scene' as const,width:100,height:100}));
  const restored = selectPageVersion(removed,'page-one',version.id);
  assert.deepEqual(restored.pages[0].referenceIds,['scene-reference']); assertImageTextDraft(restored);
});