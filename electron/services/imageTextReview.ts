import type { ImageTextDraft, ImageTextPage, ImagePageVersion } from './imageTextTypes';
import { affectedPages, pageRenderKey, publicationText } from './imageTextModel';

// 团队尚未提供现行数值；提供后在此配置，未配置时不作数值判断。
export const IMAGE_TEXT_LIMITS: { title?: number; body?: number; tags?: number } = {};
export function verifyImageEvidence(draft: ImageTextDraft, docs: Array<{ id: string; enabled: boolean; fullContent: string }>) {
  const normalize = (s: string) => s.replace(/\s+/g, '');
  return (draft.evidence || []).map(evidence => {
    const doc = docs.find(d => d.id === evidence.documentId);
    const status = !doc || !doc.enabled ? '文档已停用或不存在' : normalize(evidence.quote) && normalize(doc.fullContent).includes(normalize(evidence.quote)) ? '已核实' : '原文未找到';
    return { ...evidence, status };
  });
}
export function isImagePageReviewed(draft: ImageTextDraft, page: ImageTextPage): boolean {
  return !!page.currentVersionId && page.reviewedVersionId === page.currentVersionId && !!page.assetId && !page.error && page.renderedKey === pageRenderKey(draft,page);
}
export function removeImageReference(draft: ImageTextDraft, id: string): ImageTextDraft {
  const reference = draft.references.find(r => r.id === id);
  if (!reference) return draft;
  return { ...draft, references: draft.references.filter(r => r.id !== id),
    archivedReferences: [...(draft.archivedReferences || []), reference],
    pages: draft.pages.map(page => ({ ...page, referenceIds: page.referenceIds.filter(ref => ref !== id) })) };
}
export function imageTextChecks(draft: ImageTextDraft, forbiddenWords: string[], limits = IMAGE_TEXT_LIMITS): Array<{ id: string; label: string; passed: boolean; detail: string }> {
  const text = publicationText(draft) + '\n' + draft.pages.map(p => p.text).join('\n');
  const forbidden = forbiddenWords.filter(word => word.trim() && text.includes(word));
  const placeholders = /待确认|待填写|TODO|内部说明|仅供内部|\[占位/iu.test(text);
  const outdated = affectedPages(draft).flatMap(page => page.assetId && page.renderedKey !== pageRenderKey(draft,page) ? [draft.pages.findIndex(p => p.id === page.id) + 1] : []);
  const failed = draft.pages.flatMap((p,i) => p.error ? [i+1] : []);
  const missing = draft.pages.flatMap((p,i) => !p.assetId ? [i+1] : []);
  const mismatch = draft.pages.flatMap((p,i) => {
    const version = draft.versions?.find(v => v.id === p.currentVersionId);
    return version && version.ratio !== draft.ratio ? [i+1] : [];
  });
  const checks = [
    { id: 'forbidden', label: '禁用词', passed: !forbidden.length, detail: forbidden.length ? forbidden.join('、') : '未发现已配置禁用词' },
    { id: 'placeholder', label: '内部说明／占位符', passed: !placeholders, detail: placeholders ? '存在待确认、内部说明或占位内容，请核对' : '未发现指定占位内容' },
    { id: 'assets', label: '每页当前图片', passed: !missing.length, detail: missing.length ? '缺少第 ' + missing.join('、') + ' 图' : '每页均有当前图' },
    { id: 'current', label: '图片与当前草稿一致', passed: !outdated.length, detail: outdated.length ? '第 ' + outdated.join('、') + ' 图仍为旧图，内容不同步，等待重生成' : '已有图片与当前草稿一致' },
    { id: 'generation', label: '生成状态', passed: !failed.length, detail: failed.length ? '第 ' + failed.join('、') + ' 图生成失败，请重试或明确采用旧版本' : '没有记录到生成失败' },
    { id: 'ratio', label: '整套比例', passed: !mismatch.length, detail: mismatch.length ? '第 ' + mismatch.join('、') + ' 图版本比例与整套设置不同' : '已生成版本比例与整套一致' },
  ];
  for (const [key,label,value] of [['title','标题长度',Array.from(draft.title).length],['body','正文长度',Array.from(draft.body).length],['tags','话题数量',draft.tags.length]] as const) {
    const limit = limits[key]; checks.push({ id: key, label, passed: limit === undefined || value <= limit, detail: limit === undefined ? '团队未提供上限，暂不作数值判断；当前 ' + value : value + ' / ' + limit });
  }
  return checks;
}
export function optimizationImpact(draft: ImageTextDraft) {
  return draft.pages.flatMap((page,index) => {
    if (page.assetId && !page.error && page.renderedKey === pageRenderKey(draft,page)) return [];
    const reasons: string[] = page.error ? ['上次生成失败'] : [];
    let before: any;
    try { before = page.renderedKey ? JSON.parse(page.renderedKey) : undefined; } catch { /* 旧稿件没有可比较指纹。 */ }
    if (!page.assetId) reasons.push('新增或尚未生成');
    else if (!before) reasons.push('原版本缺少可比较信息');
    else {
      const after = JSON.parse(pageRenderKey(draft,page));
      if (before.text !== after.text) reasons.push('图内文字');
      if (before.visual !== after.visual) reasons.push('画面要求');
      if (before.style !== after.style || JSON.stringify(before.styleCard) !== JSON.stringify(after.styleCard)) reasons.push('整套风格卡');
      if (before.ratio !== after.ratio) reasons.push('整套比例');
      if (JSON.stringify(before.references) !== JSON.stringify(after.references)) reasons.push('参考素材');
    }
    return [{ pageId: page.id, number: index+1, reasons }];
  });
}
export function appendPageVersion(draft: ImageTextDraft, pageId: string, result: {assetId:string;renderedKey:string}, newId: () => string): ImageTextDraft {
  const page = draft.pages.find(p => p.id === pageId)!;
  const versions = [...(draft.versions || [])];
  const snapshot = (p: ImageTextPage, id: string): ImagePageVersion => ({ id, pageId, assetId: p.assetId!, renderedKey: p.renderedKey || '', text: p.text, visual: p.visual,
    referenceIds: [...p.referenceIds], ratio: draft.ratio, style: draft.style, styleCard: draft.styleCard, createdAt: new Date().toISOString(), reviewed: false });
  if (page.assetId && !versions.some(v => v.pageId === pageId && v.assetId === page.assetId)) {
    let prior = { ...page }; let baseline: any;
    try { baseline = JSON.parse(page.renderedKey || '{}'); } catch { baseline = {}; }
    prior = {...prior,text:baseline.text ?? prior.text,visual:baseline.visual ?? prior.visual,referenceIds:baseline.references ?? prior.referenceIds};
    const previous = snapshot(prior,newId()); previous.ratio = baseline.ratio || draft.ratio; previous.style = baseline.style || draft.style; previous.styleCard = baseline.styleCard;
    versions.push(previous);
  }
  const version = snapshot({ ...page, ...result },newId()); versions.push(version);
  return { ...draft, versions, pages: draft.pages.map(p => p.id === pageId ? { ...p, ...result, error: undefined, currentVersionId: version.id, reviewedVersionId: undefined } : p) };
}
export function selectPageVersion(draft: ImageTextDraft, pageId: string, versionId: string): ImageTextDraft {
  const version = draft.versions?.find(v => v.id === versionId && v.pageId === pageId);
  if (!version) throw new Error('页面版本不存在。');
  return { ...draft, versions: draft.versions!.map(v => v.id === versionId ? { ...v, reviewed: false } : v), pages: draft.pages.map(p => p.id === pageId ? {
    ...p, text: version.text, visual: version.visual, referenceIds: [...version.referenceIds], assetId: version.assetId, renderedKey: version.renderedKey,
    currentVersionId: version.id, reviewedVersionId: undefined, error: undefined } : p) };
}
export function internalImageTextChecklist(draft: ImageTextDraft, docs: Array<{id:string;enabled:boolean;fullContent:string}>, forbidden: string[]): string {
  return ['内部核对清单（不用于发布）', ...imageTextChecks(draft,forbidden).map(c => (c.passed ? '通过：' : '提醒：') + c.label + '，' + c.detail),
    ...verifyImageEvidence(draft,docs).map(e => e.status + '：' + e.claim + '\n依据：' + e.quote),
    ...draft.notices.map(n => '被省略信息／提取说明：' + n),
    ...draft.pages.flatMap((p,i) => isImagePageReviewed(draft,p) ? [] : ['第 ' + (i+1) + ' 图：图内文字尚未人工核对'])].join('\n');
}

export function editImageTextStructure(draft: ImageTextDraft, action: 'add'|'delete'|'copy'|'split'|'merge'|'up'|'down', pageId: string, newId: () => string): ImageTextDraft {
  const pages = [...draft.pages]; const i = pages.findIndex(p => p.id === pageId);
  const page = pages[i];
  if (action === 'add' && pages.length < 30) return {...draft,pages:[...pages,{id:newId(),text:'',visual:'',referenceIds:[]}]};
  if (!page) return draft;
  const clone = () => ({id:newId(),text:page.text,visual:page.visual,referenceIds:[...page.referenceIds]});
  if (action === 'delete' && pages.length > 1) pages.splice(i,1);
  if (action === 'copy' && pages.length < 30) pages.splice(i+1,0,clone());
  if (action === 'split' && pages.length < 30) {const cut=Math.ceil(page.text.length/2); pages[i]={...page,text:page.text.slice(0,cut)};pages.splice(i+1,0,{...clone(),text:page.text.slice(cut)});}
  if (action === 'merge' && pages[i+1]) {const next=pages[i+1];pages[i]={...page,text:page.text+'\n'+next.text,visual:page.visual+'；'+next.visual,referenceIds:[...new Set([...page.referenceIds,...next.referenceIds])]};pages.splice(i+1,1);}
  if (action === 'up' && i>0) [pages[i-1],pages[i]]=[pages[i],pages[i-1]];
  if (action === 'down' && i<pages.length-1) [pages[i+1],pages[i]]=[pages[i],pages[i+1]];
  return {...draft,pages};
}
