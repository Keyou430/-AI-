import { dialog, nativeImage, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { deleteImageTextWithAssets, imageTextDeletionInfo } from './imageTextDeletion';
import { appendPageVersion, internalImageTextChecklist, imageTextChecks, verifyImageEvidence, isImagePageReviewed } from './imageTextReview';
import type { ImageAssetLocationService } from './imageAssetLocation';
import type { LocalSQLiteManager } from '../db/sqliteService';
import type { LocalProviderService } from './localProviderService';
import { ImageTextAssets, MAX_IMAGE_BYTES } from './imageTextAssets';
import { applyImageTextPlan, assertImageTextDraft, imageTextPlanningPrompt, publicationText, affectedPages, assertImageRatio } from './imageTextModel';
import { ImageGenerationError, generateImageTextImage } from './imageGenerationService';
import { streamGenerateScript } from './llmService';
import type { ImageTextDraft, ImageTextPlanInput, ImageReference } from './imageTextTypes';

type Listener = (event: IpcMainInvokeEvent, payload: any, operationId: string) => any;
interface Dependencies {
  handle: (channel: string, listener: Listener) => void;
  withTask: <T>(senderId: number, task: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  database: () => LocalSQLiteManager;
  directory: () => string;
  dataDirectory: () => string;
  assetLocation: () => ImageAssetLocationService;
  providers: LocalProviderService;
  window: () => BrowserWindow | null;
  onCleanupError: (error: unknown) => void;
  onCheck: (draftId: string, checkId: string, passed: boolean) => void;
}
export function registerImageTextHandlers(deps: Dependencies) {
  const { handle } = deps;
  const running = new Map<string, AbortController>();
  const generating = new Set<string>();
  const assets = () => new ImageTextAssets(deps.directory());
  async function recordChecks(draft: ImageTextDraft, forbiddenWords?: string[]) {
    const docs = await deps.database().listKnowledgeDocs();
    for (const check of imageTextChecks(draft, forbiddenWords || [])) {
      if (check.id !== 'forbidden' || forbiddenWords) deps.onCheck(draft.id, check.id, check.passed);
    }
    deps.onCheck(draft.id, 'evidence', verifyImageEvidence(draft, docs).every(item => item.status === '已核实'));
    deps.onCheck(draft.id, 'notices', !draft.notices.length);
    deps.onCheck(draft.id, 'manual-review', draft.pages.every(page => isImagePageReviewed(draft, page)));
  }
  async function task<T>(event: IpcMainInvokeEvent, taskId: string, action: (signal: AbortSignal) => Promise<T>) {
    if (typeof taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(taskId)) throw new Error('任务标识无效。');
    const key = event.sender.id + ':' + taskId;
    if (running.has(key)) throw new Error('该任务正在执行，请勿重复提交。');
    const controller = new AbortController(); running.set(key, controller);
    try { return await deps.withTask(event.sender.id, async parentSignal => {
      const signal = AbortSignal.any([parentSignal, controller.signal]);
      const data = await action(signal); signal.throwIfAborted(); return { success: true, data };
    }); } finally { running.delete(key); }
  }
  handle('image-text:storage:get', () => ({ success: true, data: deps.assetLocation().get(deps.dataDirectory()) }));
  handle('image-text:storage:choose', async () => {
    const window = deps.window(); if (!window) throw new Error('窗口尚未就绪。');
    const result = await dialog.showOpenDialog(window,{title:'选择图文素材存储地址',properties:['openDirectory','createDirectory']});
    if (result.canceled) return { success: true, canceled: true };
    return { success: true, data: deps.assetLocation().schedule(result.filePaths[0],deps.dataDirectory()) };
  });
  handle('image-text:storage:follow', () => ({ success: true, data: deps.assetLocation().schedule(undefined,deps.dataDirectory()) }));
  handle('image-text:cancel', (event, taskId: string) => {
    running.get(event.sender.id + ':' + taskId)?.abort(); return { success: true };
  });
  handle('image-text:plan', (event, input: ImageTextPlanInput) => task(event, input.taskId, async signal => {
    assertImageTextDraft(input.draft);
    if (input.instruction !== undefined && (typeof input.instruction !== 'string' || input.instruction.length > 10000)) throw new Error('优化要求过长。');
    const config = deps.providers.read();
    if (!config.llmApiKey || !config.llmBaseUrl || !config.llmModel) throw new Error('请先在设置中配置文本模型。');
    const knowledge = (await deps.database().listKnowledgeDocs()).filter(d => d.enabled);
    const prompt = imageTextPlanningPrompt(input.draft, knowledge, input.instruction);
    const output = await streamGenerateScript({ requestId: input.taskId,
      config: { apiKey: config.llmApiKey, baseURL: config.llmBaseUrl, model: config.llmModel },
      systemPrompt: prompt.system, userPrompt: prompt.user, targetDurationSec: 0, userCameraWork: '' }, () => {}, signal);
    signal.throwIfAborted();
    const draft = applyImageTextPlan(input.draft, output, randomUUID);
    await recordChecks(draft);
    return draft;
  }));
  handle('image-text:generate', async (event, input: { draft: ImageTextDraft; pageId: string; taskId: string; usePreviousImage?: boolean }) => {
    assertImageTextDraft(input.draft);
    const key = event.sender.id + ':' + input.draft.id + ':' + input.pageId;
    if (generating.has(key)) throw new Error('该图片正在生成，请勿重复提交。');
    generating.add(key);
    try { return await task(event, input.taskId, async signal => {
      const store = assets();
      const result = await generateImageTextImage(input, deps.providers.read(), store, signal);
      let committed = false;
      try {
        const image = nativeImage.createFromBuffer(await store.read(result.assetId));
        if (image.isEmpty()) throw new Error('图片生成接口返回的图片无法解码，已保留旧图，请重试。');
        const { width, height } = image.getSize();
        assertImageRatio(width, height, input.draft.ratio);
        signal.throwIfAborted();
        const draft = appendPageVersion(input.draft,input.pageId,result,randomUUID);
        let persistenceError: string | undefined;
        try { await deps.database().saveImageTextRecord(draft); }
        catch (error) { deps.onCleanupError(error); persistenceError = '图片已生成并落盘，但历史保存失败，请重试保存或先导出素材包。'; }
        committed = true;
        return { ...result, draft, persistenceError };
      } catch (error) {
        if (!committed) await store.remove(result.assetId).catch(deps.onCleanupError);
        throw error;
      }
    }); }
    catch (error) {
      if (error instanceof ImageGenerationError) return { success: false, error: error.message, errorCode: error.code };
      throw error;
    } finally { generating.delete(key); }
  });
  handle('image-text:references', async (_event, input: { kind: 'style' | 'scene'; draft: ImageTextDraft }) => {
    const { kind, draft } = input;
    assertImageTextDraft(draft);
    if (!['style', 'scene'].includes(kind)) throw new Error('参考图片用途无效。');
    const window = deps.window(); if (!window) throw new Error('窗口尚未就绪。');
    const result = await dialog.showOpenDialog(window, { title: kind === 'style' ? '选择原帖风格参考图' : '选择实际场景参考图',
      properties: ['openFile', 'multiSelections'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled) return { success: true, canceled: true };
    if (draft.references.length + result.filePaths.length > 30) throw new Error('整套最多保存 30 张参考图。');
    const references: ImageReference[] = [];
    const store = assets();
    try {
      for (const file of result.filePaths) {
        if ((await fs.stat(file)).size > MAX_IMAGE_BYTES) throw new Error('单张参考图不能超过 20 MB。');
        const image = nativeImage.createFromBuffer(await fs.readFile(file));
        if (image.isEmpty()) throw new Error('参考图片无法解码，请使用有效的 PNG、JPEG 或 WebP。');
        const { width, height } = image.getSize();
        const id = await store.save(image.toPNG());
        references.push({ id, name: path.basename(file), kind, width, height });
      }
      // 素材先归档，取消优化或关闭窗口后仍可追踪和清理；页面绑定由确认操作提交。
      await deps.database().saveImageTextRecord({ ...draft, references: [...draft.references, ...references] });
      return { success: true, data: references };
    } catch (error) {
      const cleanup = await Promise.allSettled(references.map(reference => store.remove(reference.id)));
      for (const result of cleanup) if (result.status === 'rejected') deps.onCleanupError(result.reason);
      throw error;
    }
  });
  handle('image-text:asset', async (_event, id: string) => ({ success: true, data: await assets().dataURL(id) }));
  handle('image-text:list', async () => ({ success: true, data: await deps.database().listImageTextRecords() }));
  handle('image-text:save', async (_event, draft: ImageTextDraft) => {
    assertImageTextDraft(draft);
    const saved = await deps.database().saveImageTextRecord(draft);
    await recordChecks(draft);
    return { success: true, data: saved };
  });
  handle('image-text:deletion-info', async (_event, id: string) => ({ success: true, data: await imageTextDeletionInfo(deps.database(),assets(),id) }));
  handle('image-text:delete', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('历史标识无效。');
    await deleteImageTextWithAssets(deps.database(),assets(),id,deps.onCleanupError); return { success: true };
  });
  handle('image-text:export', async (_event, input: { draft: ImageTextDraft; forbiddenWords?: string[] }) => {
    const { draft, forbiddenWords = [] } = input;
    assertImageTextDraft(draft);
    if (!Array.isArray(forbiddenWords) || forbiddenWords.some(w => typeof w !== 'string' || w.length > 1000)) throw new Error('禁用词格式无效。');
    if (!draft.pages.length) throw new Error('稿件尚无页面，请先策划图文。');
    await recordChecks(draft, forbiddenWords);
    const window = deps.window(); if (!window) throw new Error('窗口尚未就绪。');
    const result = await dialog.showOpenDialog(window, { title: '选择图文素材包导出目录', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return { success: true, canceled: true };
    const directory = path.join(result.filePaths[0], '小红书图文-' + Date.now() + '-' + randomUUID().slice(0, 8));
    await fs.mkdir(directory);
    for (const [i, page] of draft.pages.entries()) {
      if (!page.assetId) continue;
      const bytes = await assets().read(page.assetId!);
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error('本地图片损坏，已停止导出。');
      await fs.writeFile(path.join(directory, String(i + 1).padStart(2, '0') + '.png'), image.toPNG(), { flag: 'wx' });
    }
    await fs.writeFile(path.join(directory, '发布文案.txt'), publicationText(draft), { encoding: 'utf8', flag: 'wx' });
    const docs = await deps.database().listKnowledgeDocs();
    await fs.writeFile(path.join(directory,'内部核对.txt'),internalImageTextChecklist(draft,docs,forbiddenWords),{encoding:'utf8',flag:'wx'});
    return { success: true, data: directory };
  });
}
