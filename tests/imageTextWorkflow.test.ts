import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useImageTextStore } from '../src/store/useImageTextStore';
import { affectedPages, pageRenderKey } from '../electron/services/imageTextModel';
import { imageTextFixture } from './helpers/imageTextFixture';

function installAPI(extra: Record<string, unknown> = {}) {
  const saved: any[] = [];
  Object.assign(globalThis, { window: { electronAPI: {
    saveImageTextHistory: async (draft: any) => { saved.push(structuredClone(draft)); return { success: true }; },
    cancelImageText: async () => ({ success: true }), ...extra,
  } } });
  useImageTextStore.setState({ ...useImageTextStore.getInitialState() });
  return saved;
}
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

test('确认前生成被阻止；失败旧图保留，成功页不随重试重复生成', async () => {
  const calls: string[] = []; let fail = true;
  installAPI({ generateImageText: async ({ draft, pageId }: any) => {
    calls.push(pageId);
    if (pageId === 'page-one' && fail) return { success: false, error: '超时' };
    return { success: true, data: { assetId: 'new-' + pageId, renderedKey: pageRenderKey(draft, draft.pages.find((p: any) => p.id === pageId)) } };
  } });
  const draft = imageTextFixture(); draft.confirmed = false;
  useImageTextStore.getState().loadDraft(draft);
  await useImageTextStore.getState().generate(); assert.deepEqual(calls, []);
  draft.confirmed = true; draft.style = '新统一风格';
  useImageTextStore.getState().loadDraft(draft);
  await useImageTextStore.getState().generate();
  let current = useImageTextStore.getState().draft!;
  assert.equal(current.pages[0].assetId, 'old-one'); assert.equal(current.pages[1].assetId, 'new-page-two');
  assert.deepEqual(affectedPages(current).map(p => p.id), ['page-one']);
  fail = false; await useImageTextStore.getState().generate();
  assert.deepEqual(calls, ['page-one', 'page-two', 'page-one']);
  assert.equal(affectedPages(useImageTextStore.getState().draft!).length, 0);
});
test('单图任务期间翻页，结果仍写入指定页；重复点击只提交一次', async () => {
  let resolve!: (value: any) => void; let count = 0;
  installAPI({ generateImageText: async ({ draft, pageId }: any) => { count++; return new Promise(r => { resolve = r; }); } });
  useImageTextStore.getState().loadDraft(imageTextFixture());
  const running = useImageTextStore.getState().generate('page-one');
  await useImageTextStore.getState().generate('page-one');
  useImageTextStore.getState().selectPage('page-two');
  resolve({ success: true, data: { assetId: 'one-new', renderedKey: 'one-key' } }); await running;
  const current = useImageTextStore.getState();
  assert.equal(count, 1); assert.equal(current.activePageId, 'page-two');
  assert.equal(current.draft!.pages[0].assetId, 'one-new'); assert.equal(current.draft!.pages[1].assetId, 'old-two');
});
test('仅优化发布文案不调用生图；修改一页只生该页', async () => {
  let alterPage = false; const generated: string[] = [];
  installAPI({ planImageText: async ({ draft }: any) => {
    draft.body = '新发布正文'; if (alterPage) draft.pages[1].text = '修改后的图内文字'; return { success: true, data: draft };
  }, generateImageText: async ({ draft, pageId }: any) => {
    generated.push(pageId); return { success: true, data: { assetId: 'updated-' + pageId, renderedKey: pageRenderKey(draft, draft.pages.find((p: any) => p.id === pageId)) } };
  } });
  useImageTextStore.getState().loadDraft(imageTextFixture());
  await useImageTextStore.getState().plan('只优化发布正文'); assert.deepEqual(generated, []);
  alterPage = true; await useImageTextStore.getState().plan('优化第二页'); assert.deepEqual(generated, ['page-two']);
});
test('取消后忽略迟到图片并停止后续页，旧结果保留', async () => {
  let resolve!: (value: any) => void; let calls = 0;
  installAPI({ generateImageText: async () => { calls++; return new Promise(r => { resolve = r; }); } });
  const draft = imageTextFixture(); draft.style = '新风格'; useImageTextStore.getState().loadDraft(draft);
  const running = useImageTextStore.getState().generate(); await useImageTextStore.getState().cancel();
  resolve({ success: true, data: { assetId: 'late', renderedKey: 'late' } }); await running;
  assert.equal(calls, 1); assert.equal(useImageTextStore.getState().draft!.pages[0].assetId, 'old-one');
});
test('策划完成后的保存期间取消，不自动启动生图', async () => {
  let saveResolve!: (value: any) => void; let images = 0;
  installAPI({ planImageText: async ({ draft }: any) => ({ success: true, data: draft }),
    saveImageTextHistory: async () => new Promise(resolve => { saveResolve = resolve; }),
    generateImageText: async () => { images++; return { success: false }; } });
  const draft = imageTextFixture(); draft.style = '新风格'; useImageTextStore.getState().loadDraft(draft);
  const running = useImageTextStore.getState().plan('优化风格'); await nextTurn();
  await useImageTextStore.getState().cancel(); saveResolve({ success: true }); await running;
  assert.equal(images, 0);
});
test('授权临时故障停止后续生图，不把其余页当失败自动继续调用', async () => {
  let calls = 0; installAPI({ generateImageText: async () => { calls++; return { success: false, errorCode: 'AUTH_UNAVAILABLE', error: '授权服务暂不可用' }; } });
  const draft = imageTextFixture(); draft.style = '新风格'; useImageTextStore.getState().loadDraft(draft);
  await useImageTextStore.getState().generate(); assert.equal(calls, 1); assert.equal(useImageTextStore.getState().taskId, null);
  assert.equal(useImageTextStore.getState().draft!.pages[0].assetId, 'old-one');
});

test('图片生成成功但历史写入失败时保留新图，重试保存不再次生图',async()=>{
  let images=0,fail=true;
  installAPI({generateImageText:async({draft,pageId}:any)=>{images++;return{success:true,data:{assetId:'retained-new',renderedKey:pageRenderKey(draft,draft.pages.find((p:any)=>p.id===pageId))}};},
    saveImageTextHistory:async()=>fail?{success:false,error:'磁盘空间不足'}:{success:true}});
  useImageTextStore.getState().loadDraft(imageTextFixture());await useImageTextStore.getState().generate('page-one');
  assert.equal(useImageTextStore.getState().draft!.pages[0].assetId,'retained-new');assert.match(useImageTextStore.getState().error!,/磁盘/);
  fail=false;await useImageTextStore.getState().save();assert.equal(images,1);
});

test('F01 重生成失败清除当前核对状态，旧图和历史版本保留', async () => {
  installAPI({generateImageText:async()=>({success:false,error:'HTTP 503'})});
  const draft=imageTextFixture(); draft.pages[0].currentVersionId='v1'; draft.pages[0].reviewedVersionId='v1';
  useImageTextStore.getState().loadDraft(draft);
  useImageTextStore.getState().updatePage('page-one',{text:'需要重生成'});
  await useImageTextStore.getState().generate('page-one');
  const page=useImageTextStore.getState().draft!.pages[0];
  assert.equal(page.assetId,'old-one'); assert.equal(page.reviewedVersionId,undefined); assert.match(page.error!,/503/);
  await useImageTextStore.getState().markReviewed('page-one',true);
  assert.equal(useImageTextStore.getState().draft!.pages[0].reviewedVersionId,undefined);
});

test('F04 未保存修改阻止历史覆盖，保存或明确放弃后才能切换',async()=>{
  installAPI(); const state=useImageTextStore.getState(); const original=imageTextFixture();
  state.loadDraft(original); state.updateDraft({body:'未保存修改'});
  assert.equal(state.hasUnsavedChanges(),true); assert.throws(()=>state.loadDraft(original),/未保存/);
  assert.equal(useImageTextStore.getState().draft!.body,'未保存修改');
  await state.save(); assert.equal(state.hasUnsavedChanges(),false); state.loadDraft(useImageTextStore.getState().draft!);
  state.updateDraft({body:'另一次修改'}); state.loadDraft(original,true);
  assert.equal(useImageTextStore.getState().draft!.body,original.body);
});

test('F04 保存失败保留脏状态，保存期间继续编辑不会被误标已保存',async()=>{
  let fail=true; let release!:()=>void;
  installAPI({saveImageTextHistory:async()=>{if(fail)return {success:false,error:'磁盘空间不足'};await new Promise<void>(resolve=>{release=resolve;});return {success:true};}});
  const state=useImageTextStore.getState();state.loadDraft(imageTextFixture());state.updateDraft({body:'第一版'});
  await assert.rejects(state.save(),/磁盘/);assert.equal(state.hasUnsavedChanges(),true);
  fail=false;const saving=state.save();state.updateDraft({body:'第二版'});release();await saving;
  assert.equal(useImageTextStore.getState().draft!.body,'第二版');assert.equal(state.hasUnsavedChanges(),true);
});

test('F03 参考图移除保存失败时不改内存及绑定，成功后归档并释放名额',async()=>{
  let fail=true;installAPI({saveImageTextHistory:async()=>({success:!fail,error:fail?'磁盘空间不足':undefined})});
  const draft=imageTextFixture();draft.references=[{id:'scene',name:'场景',kind:'scene',width:1,height:1}];draft.pages[0].referenceIds=['scene'];
  const state=useImageTextStore.getState();state.loadDraft(draft);
  await assert.rejects(state.removeReference('scene'),/磁盘/);assert.equal(useImageTextStore.getState().draft!.references.length,1);
  fail=false;await state.removeReference('scene');const removed=useImageTextStore.getState().draft!;
  assert.equal(removed.references.length,0);assert.deepEqual(removed.pages[0].referenceIds,[]);assert.equal(removed.archivedReferences![0].id,'scene');
});

test('F05 鉴权、额度和限流错误停止后续页，恢复配置后只重试未完成页',async()=>{
  for(const code of ['AGNES_AUTH','AGNES_QUOTA','AGNES_RATE_LIMIT','IMAGE_AUTH','IMAGE_QUOTA','IMAGE_RATE_LIMIT']){
    let calls=0;let failure=true;installAPI({generateImageText:async({draft,pageId}:any)=>{
      calls++;return failure?{success:false,errorCode:code,error:'Agnes 前置条件不可用'}:{success:true,data:{assetId:'fixed-'+pageId,renderedKey:pageRenderKey(draft,draft.pages.find((p:any)=>p.id===pageId))}};
    }});
    const draft=imageTextFixture();draft.style='新风格';const state=useImageTextStore.getState();state.loadDraft(draft);
    await state.generate();assert.equal(calls,1);assert.match(useImageTextStore.getState().error!,/停止后续/);
    failure=false;await state.generate();assert.equal(calls,3);assert.equal(affectedPages(useImageTextStore.getState().draft!).length,0);
  }
});

test('F03 移除素材期间继续编辑时保留人工修改，并维持未保存状态',async()=>{
  let release!:()=>void; let persisted:any;
  installAPI({saveImageTextHistory:async(draft:any)=>{persisted=structuredClone(draft);await new Promise<void>(resolve=>{release=resolve;});return {success:true};}});
  const draft=imageTextFixture();draft.references=[{id:'scene',name:'场景',kind:'scene',width:1,height:1}];draft.pages[0].referenceIds=['scene'];
  const state=useImageTextStore.getState();state.loadDraft(draft);const removing=state.removeReference('scene');
  state.updateDraft({body:'移除期间继续编辑的正文'});release();await removing;
  const current=useImageTextStore.getState().draft!;assert.equal(current.body,'移除期间继续编辑的正文');
  assert.equal(current.references.length,0);assert.deepEqual(current.pages[0].referenceIds,[]);assert.equal(current.archivedReferences![0].id,'scene');
  assert.equal(persisted.body,draft.body);assert.equal(state.hasUnsavedChanges(),true);
});

test('F05 全局供应商错误后保存失败也不继续请求后续页面',async()=>{
  let calls=0;let saves=0;
  installAPI({generateImageText:async()=>{calls++;return {success:false,errorCode:'AGNES_AUTH',error:'Agnes 密钥无效'};},
    saveImageTextHistory:async()=>({success:++saves>1,error:'磁盘暂时不可写'})});
  const draft=imageTextFixture();draft.style='需要重生成';const state=useImageTextStore.getState();state.loadDraft(draft);
  await state.generate();assert.equal(calls,1);assert.equal(saves,1);assert.equal(useImageTextStore.getState().taskId,null);
  assert.match(useImageTextStore.getState().error!,/已停止后续生图/);assert.match(useImageTextStore.getState().error!,/磁盘/);
  assert.equal(affectedPages(useImageTextStore.getState().draft!).length,2);assert.equal(state.hasUnsavedChanges(),true);
});

test('U06 前后插图相对当前页排序、选中新页，并完整保留原图及版本', () => {
  installAPI(); const state = useImageTextStore.getState(); const draft = imageTextFixture();
  state.loadDraft(draft); state.selectPage('page-two'); state.addPage('before');
  let current = useImageTextStore.getState(); const beforeId = current.activePageId;
  assert.deepEqual(current.draft!.pages.map(page => page.id), ['page-one', beforeId, 'page-two']);
  assert.deepEqual(current.draft!.pages.filter(page => page.id !== beforeId), draft.pages);
  assert.deepEqual(current.draft!.versions, draft.versions);
  assert.deepEqual(current.draft!.pages[1].referenceIds, []);
  state.selectPage('page-two'); state.addPage('after'); current = useImageTextStore.getState();
  assert.deepEqual(current.draft!.pages.map(page => page.id), ['page-one', beforeId, 'page-two', current.activePageId]);
  state.selectPage('page-one'); state.addPage('before'); current = useImageTextStore.getState();
  assert.equal(current.draft!.pages[0].id, current.activePageId);
});

test('U06 插图遵守30页和任务锁，最后一图不可删除', () => {
  installAPI(); const state = useImageTextStore.getState(); const draft = imageTextFixture();
  draft.pages = Array.from({ length: 30 }, (_, i) => ({ ...draft.pages[0], id: 'page-' + i }));
  state.loadDraft(draft); const full = useImageTextStore.getState().draft; state.addPage('after'); assert.equal(useImageTextStore.getState().draft, full);
  state.loadDraft(imageTextFixture(), true); useImageTextStore.setState({ taskId: 'busy' });
  const locked = useImageTextStore.getState().draft; state.addPage('before'); assert.equal(useImageTextStore.getState().draft, locked);
  useImageTextStore.setState({ taskId: null }); state.removePage('page-two'); state.removePage('page-one');
  assert.equal(useImageTextStore.getState().draft!.pages.length, 1);
});
