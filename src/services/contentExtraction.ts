import { useAppStore } from '../store/useAppStore';
import { useImageTextStore } from '../store/useImageTextStore';
import { parseVideoLinkClient } from './ipcClient';
import { classifyContent } from '../../electron/services/imageTextModel';
import type { ParsedVideoInfo } from '../types';

export function routeExtractedContent(source: ParsedVideoInfo, manualKind?: 'video' | 'image-text'): void {
  if (manualKind) source = { ...source, contentKind: manualKind, contentKindEvidence: '用户人工指定内容类型' };
  const app = useAppStore.getState();
  const kind = manualKind || classifyContent(source);
  if (kind === 'unknown') { useImageTextStore.getState().setPendingSource(source); return; }
  if (kind === 'image-text') {
    if (source.platform !== 'xiaohongshu') throw new Error('图文模块当前仅支持小红书图文。');
    useImageTextStore.getState().begin(source, manualKind ? 'manual' : 'automatic');
    app.setActiveNav('image-text');
  } else {
    useImageTextStore.getState().setPendingSource(null);
    app.setParsedVideo(source);
    if (source.durationSec > 0) app.setTargetDurationSec(Math.min(180, Math.max(6, Math.round(source.durationSec))));
    if (!app.userCameraWork.trim() && source.suggestedCameraWork) app.setUserCameraWork(source.suggestedCameraWork);
    app.setActiveNav('workbench');
  }
}
export async function extractAndRoute(rawInput: string): Promise<ParsedVideoInfo | undefined> {
  const state = useAppStore.getState();
  if (state.isParsingVideo || state.isGeneratingScript || useImageTextStore.getState().taskId) throw new Error('有任务正在执行，请等待完成或取消后再提取。');
  const revision = state.workbenchRevision;
  state.setIsParsingVideo(true);
  try {
    const result = await parseVideoLinkClient(rawInput, state.settings);
    if (useAppStore.getState().workbenchRevision !== revision) return;
    if (!result.success || !result.data) {
      if (result.data && classifyContent(result.data) === 'video') state.setParsedVideo(result.data);
      throw new Error(result.errorMessage || '提取失败，请检查链接、厂商权限或余额后手动重试。');
    }
    routeExtractedContent(result.data);
    return result.data;
  } finally { useAppStore.getState().setIsParsingVideo(false); }
}
