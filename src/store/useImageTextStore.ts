import { create } from 'zustand';
import type { ParsedVideoInfo } from '../types';
import { appendPageVersion, selectPageVersion, editImageTextStructure, removeImageReference } from '../../electron/services/imageTextReview';
import { affectedPages } from '../../electron/services/imageTextModel';
import { IMAGE_RATIOS, type ImageReference, type ImageTextDraft, type ImageTextPage } from '../../electron/services/imageTextTypes';
import '../services/ipcClient';

const newId = () => crypto.randomUUID();
function api() {
  if (!window.electronAPI) throw new Error('图文二创需在桌面客户端中运行。');
  return window.electronAPI;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '图文操作失败，请重试。';
interface ImageTextState {
  draft: ImageTextDraft | null;
  records: ImageTextDraft[];
  savedDraftKey: string | null;
  hasUnsavedChanges(): boolean;
  pendingSource: ParsedVideoInfo | null;
  activePageId: string | null;
  taskId: string | null;
  taskKind: 'plan' | 'generate' | null;
  progress: string;
  error: string | null;
  setPendingSource(source: ParsedVideoInfo | null): void;
  selectPage(id: string): void;
  updateDraft(patch: Partial<Pick<ImageTextDraft, 'title' | 'body' | 'tags' | 'style' | 'styleCard' | 'ratio' | 'ratioOrigin'>>): void;
  updatePage(id: string, patch: Partial<Pick<ImageTextPage, 'text' | 'visual' | 'referenceIds'>>): void;
  addPage(position: 'before' | 'after'): void;
  removePage(id: string): void;
  begin(source: ParsedVideoInfo, origin: 'automatic' | 'manual'): void;
  plan(instruction?: string): Promise<void>;
  previewOptimization(draft: ImageTextDraft, instruction: string): Promise<ImageTextDraft>;
  generate(pageId?: string, usePreviousImage?: boolean): Promise<void>;
  changeVersion(pageId: string, versionId: string): Promise<void>;
  markReviewed(pageId: string, reviewed: boolean): Promise<void>;
  editStructure(action: 'copy' | 'split' | 'merge' | 'up' | 'down', pageId: string): void;
  confirmAndGenerate(): Promise<void>;
  addReferences(kind: ImageReference['kind'], pageId?: string): Promise<void>;
  removeReference(id: string): Promise<void>;
  save(): Promise<void>;
  loadRecords(): Promise<void>;
  loadDraft(draft: ImageTextDraft, discardChanges?: boolean): void;
  deleteRecord(id: string): Promise<void>;
  cancel(): Promise<void>;
  reset(): void;
}
export const useImageTextStore = create<ImageTextState>((set, get) => ({
  draft: null, records: [], savedDraftKey: null,
  hasUnsavedChanges: () => !!get().draft && JSON.stringify(get().draft) !== get().savedDraftKey,
  pendingSource: null, activePageId: null, taskId: null, taskKind: null, progress: '', error: null,
  setPendingSource: source => set({ pendingSource: source }),
  selectPage: id => set({ activePageId: id }),
  updateDraft: patch => { if (!get().taskId && get().draft) set({ draft: { ...get().draft!, ...patch } }); },
  updatePage: (id, patch) => { const d = get().draft; if (!get().taskId && d) set({ draft: { ...d, pages: d.pages.map(p => p.id === id ? { ...p, ...patch, error: undefined } : p) } }); },
  addPage: position => {
    const d = get().draft; if (!d || get().taskId || d.pages.length >= 30) return;
    const page = { id: newId(), text: '', visual: '', referenceIds: [] };
    const index = d.pages.findIndex(p => p.id === get().activePageId);
    const insertion = Math.max(0, index) + (position === 'after' && d.pages.length ? 1 : 0);
    set({ draft: { ...d, pages: [...d.pages.slice(0, insertion), page, ...d.pages.slice(insertion)] }, activePageId: page.id });
  },
  removePage: id => {
    const d = get().draft; if (!d || get().taskId || d.pages.length <= 1) return;
    const index = d.pages.findIndex(p => p.id === id); if (index < 0) return;
    const pages = d.pages.filter(p => p.id !== id);
    const activePageId = get().activePageId === id ? pages[Math.min(index, pages.length - 1)].id : get().activePageId;
    set({ draft: { ...d, pages }, activePageId });
  },
  begin: (source, typeOrigin) => {
    if (get().taskId) throw new Error('图文任务正在执行，请先取消或等待完成。');
    const draft: ImageTextDraft = { id: newId(), createdAt: new Date().toISOString(), source, typeOrigin,
      title: source.title, body: '', tags: [], style: '', ratio: '3:4',
      ratioOrigin: '未取得原图尺寸，暂用 3:4；请在本次确认前核对，或上传原帖图自动匹配比例。',
      references: [], pages: [], notices: [], confirmed: false };
    set({ draft, savedDraftKey: null, pendingSource: null, activePageId: null, error: null, progress: '' });
    void get().plan();
  },
  plan: async instruction => {
    const draft = get().draft; if (!draft || get().taskId) return;
    const taskId = newId(); set({ taskId, taskKind: 'plan', progress: instruction ? '正在全局优化文案与分页…' : '正在融合知识库并策划图文草案…', error: null });
    let runImages = false;
    try {
      const result = await api().planImageText({ draft: structuredClone(draft), instruction, taskId });
      if (get().taskId !== taskId) return;
      if (!result.success || !result.data) throw new Error(result.error || '图文策划失败，请检查文本模型配置。');
      set({ draft: result.data, activePageId: result.data.pages.some(p => p.id === get().activePageId) ? get().activePageId : result.data.pages[0]?.id || null });
      await get().save();
      runImages = get().taskId === taskId && !!instruction && result.data.confirmed;
    } catch (error) { if (get().taskId === taskId) set({ error: errorMessage(error) }); }
    finally { if (get().taskId === taskId) set({ taskId: null, taskKind: null, progress: '' }); }
    if (runImages && get().draft?.id === draft.id) await get().generate();
  },
  previewOptimization: async (draft, instruction) => {
    if (get().taskId) throw new Error('请等待当前任务完成。');
    const taskId = newId(); set({ taskId, taskKind: 'plan', error: null, progress: '正在生成优化预览，尚未提交生图…' });
    try {
      const result = await api().planImageText({ draft: structuredClone(draft), instruction, taskId });
      if (get().taskId !== taskId) throw new Error('优化预览已取消。');
      if (!result.success || !result.data) throw new Error(result.error || '优化预览生成失败。');
      return result.data;
    } finally { if (get().taskId === taskId) set({ taskId: null, taskKind: null, progress: '' }); }
  },
  changeVersion: async (pageId, versionId) => {
    const draft = get().draft; if (!draft || get().taskId) return;
    set({ draft: selectPageVersion(draft,pageId,versionId) });
    await get().save();
  },
  markReviewed: async (pageId, reviewed) => {
    const draft = get().draft; if (!draft || get().taskId) return;
    const page = draft.pages.find(p => p.id === pageId); if (!page?.currentVersionId) return;
    if (reviewed && (page.error || affectedPages(draft).some(p => p.id === pageId))) return;
    set({ draft: { ...draft, pages: draft.pages.map(p => p.id === pageId ? { ...p, reviewedVersionId: reviewed ? p.currentVersionId : undefined } : p),
      versions: draft.versions?.map(v => v.id === page.currentVersionId ? { ...v, reviewed } : v) } });
    await get().save();
  },
  editStructure: (action,pageId) => { const draft = get().draft; if (draft && !get().taskId) set({draft:editImageTextStructure(draft,action,pageId,newId)}); },
  generate: async (pageId, usePreviousImage) => {
    const draft = get().draft; if (!draft || get().taskId) return;
    if (!draft.confirmed) { set({ error: '请先核对文案、张数及比例，并确认一次。' }); return; }
    const pages = pageId ? draft.pages.filter(p => p.id === pageId) : affectedPages(draft);
    if (!pages.length) { await get().save().catch(error => set({ error: errorMessage(error) })); return; }
    const taskId = newId(); set({ taskId, taskKind: 'generate', error: null,
      draft: { ...draft, pages: draft.pages.map(page => pages.some(p => p.id === page.id) ? { ...page, reviewedVersionId: undefined } : page) } });
    let failed = 0;
    try {
      for (const [index, page] of pages.entries()) {
        if (get().taskId !== taskId) return;
        set({ progress: '正在校验授权并生成受影响图片 ' + (index + 1) + ' / ' + pages.length });
        let persisted = false;
        try {
          const snapshot = structuredClone(get().draft!);
          const result = await api().generateImageText({ draft: snapshot, pageId: page.id, taskId, usePreviousImage: pageId ? usePreviousImage : false });
          if (get().taskId !== taskId) return;
          if (result.errorCode && ['AUTH_REQUIRED', 'ACCOUNT_DISABLED', 'AUTH_UNAVAILABLE'].includes(result.errorCode)) {
            set({ taskId: null, taskKind: null, progress: '', error: result.error || '授权状态不可用，已停止后续生图。' }); return;
          }
          if (!result.success && ['AGNES_AUTH', 'AGNES_QUOTA', 'AGNES_RATE_LIMIT', 'IMAGE_AUTH', 'IMAGE_QUOTA', 'IMAGE_RATE_LIMIT', 'IMAGE_UNSUPPORTED'].includes(result.errorCode || '')) {
            const message = (result.error || '图片生成配置或额度不可用。') + ' 已停止后续生图，请处理后重试未完成图片。';
            const current = get().draft!;
            set({ draft: { ...current, pages: current.pages.map(p => p.id === page.id ? { ...p, error: message } : p) }, error: message });
            try { await get().save(); } catch (error) { set({ error: message + ' ' + errorMessage(error) }); }
            return;
          }
          if (!result.success || !result.data) throw new Error(result.error || '图片生成失败。');
          const current = get().draft!;
          const completed = result.data.draft || appendPageVersion(current,page.id,result.data!,newId);
          persisted = !!result.data.draft && !result.data.persistenceError;
          set({ draft: completed, ...(result.data.persistenceError ? { error: result.data.persistenceError } : {}),
            ...(persisted ? { savedDraftKey: JSON.stringify(completed),
              records: [structuredClone(completed), ...get().records.filter(record => record.id !== completed.id)].sort((a,b) => b.createdAt.localeCompare(a.createdAt)) } : {}) });
        } catch (error) {
          if (get().taskId !== taskId) return;
          failed++;
          const current = get().draft!;
          set({ draft: { ...current, pages: current.pages.map(p => p.id === page.id ? { ...p, error: errorMessage(error) } : p) } });
        }
        if (!persisted) await get().save();
      }
      if (failed && get().taskId === taskId) set({ error: (pageId && get().draft!.pages.find(page => page.id === pageId)?.error) || failed + ' 张图片未完成，旧图与成功页面已保留，可只重试未完成页面。' });
    } catch (error) { if (get().taskId === taskId) set({ error: errorMessage(error) }); }
    finally { if (get().taskId === taskId) set({ taskId: null, taskKind: null, progress: '' }); }
  },
  confirmAndGenerate: async () => {
    const d = get().draft; if (!d || get().taskId) return;
    if (!d.pages.length || d.pages.some(p => !p.text.trim() || !p.visual.trim()) || (!d.style.trim() && !Object.values(d.styleCard || {}).some(value => value.trim()))) {
      set({ error: '请补齐每页文字、画面要求及整套风格后确认。' }); return;
    }
    set({ draft: { ...d, confirmed: true }, error: null });
    try { await get().save(); await get().generate(); }
    catch (error) { set({ error: errorMessage(error) }); }
  },
  addReferences: async (kind, pageId) => {
    const original = get().draft; if (!original || get().taskId) return;
    try {
      const result = await api().selectImageTextReferences(kind, structuredClone(original));
      if (result.canceled || get().draft?.id !== original.id || get().taskId) return;
      if (!result.success || !result.data) throw new Error(result.error || '参考图导入失败。');
      const current = get().draft!;
      if (current.references.length + result.data.length > 30) throw new Error('整套最多保存 30 张参考图，请先移除不需要的素材。');
      const refs = result.data;
      let ratio = current.ratio; let ratioOrigin = current.ratioOrigin;
      if (kind === 'style' && !current.confirmed && !current.references.some(r => r.kind === 'style') && refs[0] && ratioOrigin.startsWith('未取得')) {
        const originalRatio = refs[0].width / refs[0].height;
        const exact = IMAGE_RATIOS.find(r => { const [w,h] = r.split(':').map(Number); return Math.abs(w/h - originalRatio) < 0.01; });
        if (exact) { ratio = exact; ratioOrigin = '跟随补传的原帖参考图比例：' + exact; }
        else ratioOrigin = '原帖参考图比例不在 图片生成支持范围内，请在本次确认前选择整套比例。';
      }
      const draft = { ...current, ratio, ratioOrigin, references: [...current.references, ...refs],
        pages: current.pages.map(p => (p.id === pageId || (kind === 'scene' && !current.confirmed)) ? { ...p, referenceIds: [...p.referenceIds, ...refs.map(r => r.id)] } : p) };
      set({ draft }); await get().save();
    } catch (error) { set({ error: errorMessage(error) }); }
  },
  removeReference: async id => {
    const draft = get().draft; if (!draft || get().taskId) return;
    const updated = removeImageReference(draft,id);
    if (updated === draft) return;
    const result = await api().saveImageTextHistory(structuredClone(updated));
    if (!result.success) throw new Error(result.error || '移除参考图失败，素材已保留。');
    const current = get().draft;
    set({ ...(current?.id === draft.id ? { draft: removeImageReference(current,id), savedDraftKey: JSON.stringify(updated) } : {}),
      records: [structuredClone(updated), ...get().records.filter(d => d.id !== updated.id)] });
  },
  save: async () => {
    const draft = get().draft; if (!draft) return;
    const result = await api().saveImageTextHistory(structuredClone(draft));
    if (!result.success) throw new Error(result.error || '保存图文历史失败。');
    if (get().draft?.id !== draft.id) return;
    set({ savedDraftKey: JSON.stringify(draft), records: [structuredClone(draft), ...get().records.filter(d => d.id !== draft.id)].sort((a,b) => b.createdAt.localeCompare(a.createdAt)) });
  },
  loadRecords: async () => {
    const result = await api().listImageTextHistory();
    if (!result.success || !result.data) throw new Error(result.error || '读取图文历史失败。');
    set({ records: result.data });
  },
  loadDraft: (draft, discardChanges = false) => {
    if (get().taskId) throw new Error('请先等待图文任务完成或取消，再打开其他历史。');
    if (!discardChanges && get().hasUnsavedChanges()) throw new Error('当前图文有未保存修改，请先保存或明确放弃后再打开历史。');
    set({ draft: structuredClone(draft), savedDraftKey: JSON.stringify(draft), activePageId: draft.pages[0]?.id || null, error: null, progress: '' });
  },
  deleteRecord: async id => {
    if (get().taskId && get().draft?.id === id) throw new Error('该图文正在处理，请先取消任务再删除。');
    const result = await api().deleteImageTextHistory(id);
    if (!result.success) throw new Error(result.error || '删除图文历史失败。');
    set({ records: get().records.filter(d => d.id !== id), ...(get().draft?.id === id ? { draft: null, savedDraftKey: null, activePageId: null } : {}) });
  },
  cancel: async () => {
    const taskId = get().taskId;
    set({ taskId: null, taskKind: null, progress: '已取消本机等待；不保证供应商任务停止或退款。' });
    if (taskId) await api().cancelImageText(taskId).catch(() => {});
  },
  reset: () => { void get().cancel(); set({ draft: null, savedDraftKey: null, records: [], pendingSource: null, activePageId: null, error: null, progress: '' }); },
}));
