import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HotspotItem, HotspotPlatformStatus, IndustryProfile, TrendingFilterTab } from '../types/trending';
import type { ParsedVideoInfo } from '../types';
import { DEFAULT_PROFILES, detectIndustryProfile, fetchTrendingHotspots, industryContext } from '../services/trendingService';
import { useAppStore } from './useAppStore';
import { useImageTextStore } from './useImageTextStore';

interface Transfer { target: 'workbench' | 'image-text'; hotspot: HotspotItem }
interface TrendingState {
  profile: IndustryProfile | null;
  hotspots: HotspotItem[];
  sources: HotspotPlatformStatus[];
  activeFilterTab: TrendingFilterTab;
  searchQuery: string;
  onlyHighMatch: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  analysisNotice: string | null;
  lastContextSignature: string;
  lastFetchedAt: number;
  pendingTransfer: Transfer | null;
  init: () => Promise<void>;
  reanalyze: () => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
  setFilterTab: (tab: TrendingFilterTab) => void;
  setSearchQuery: (query: string) => void;
  setOnlyHighMatch: (only: boolean) => void;
  addCategoryTag: (tag: string) => void;
  removeCategoryTag: (tag: string) => void;
  selectProfileTemplate: (key: string) => void;
  transferToWorkbench: (hotspot: HotspotItem) => void;
  transferToImageText: (hotspot: HotspotItem) => void;
  confirmTransfer: (saveFirst?: boolean) => Promise<void>;
  cancelTransfer: () => void;
  resetSession: () => void;
}

let requestVersion = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let initializing: { signature: string; promise: Promise<void> } | undefined;
const TTL_MS = 20 * 60 * 1000;
function contextSignature(): string {
  const { knowledgeDocs, keywords } = useAppStore.getState();
  return JSON.stringify({ ...industryContext(knowledgeDocs, keywords), forbidden: keywords.filter(k => k.category === 'forbidden').map(k => k.text) });
}

export const useTrendingStore = create<TrendingState>()(persist((set, get) => ({
  profile: null, hotspots: [], sources: [], activeFilterTab: 'all', searchQuery: '', onlyHighMatch: false,
  isLoading: false, isRefreshing: false, error: null, analysisNotice: null,
  lastContextSignature: '', lastFetchedAt: 0, pendingTransfer: null,
  init: async () => {
    const signature = contextSignature();
    if (initializing?.signature === signature) return initializing.promise;
    const state = get();
    if (!state.lastFetchedAt && state.profile) set({ activeFilterTab: 'recommended' });
    if (signature === state.lastContextSignature && state.lastFetchedAt && Date.now() - state.lastFetchedAt < TTL_MS) return;
    const shouldAnalyze = !state.profile || (state.profile.isAutoDetected && signature !== state.lastContextSignature);
    const promise = loadTrending(shouldAnalyze, false);
    initializing = { signature, promise };
    try { await promise; } finally { if (initializing?.promise === promise) initializing = undefined; }
  },
  reanalyze: () => loadTrending(true, false),
  refresh: (force = true) => loadTrending(false, force),
  setFilterTab: activeFilterTab => set({ activeFilterTab }),
  setSearchQuery: searchQuery => set({ searchQuery }),
  setOnlyHighMatch: onlyHighMatch => set({ onlyHighMatch }),
  addCategoryTag: tag => {
    const profile = get().profile; const value = tag.trim().slice(0, 100);
    if (!profile || !value || profile.subCategories.includes(value) || profile.subCategories.length >= 8) return;
    changeProfile({ ...profile, subCategories: [...profile.subCategories, value] });
  },
  removeCategoryTag: tag => {
    const profile = get().profile;
    if (profile) changeProfile({ ...profile, subCategories: profile.subCategories.filter(t => t !== tag) });
  },
  selectProfileTemplate: key => {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_PROFILES, key)) changeProfile({ ...DEFAULT_PROFILES[key], subCategories: [...DEFAULT_PROFILES[key].subCategories] }, true);
  },
  transferToWorkbench: hotspot => requestTransfer({ target: 'workbench', hotspot }),
  transferToImageText: hotspot => requestTransfer({ target: 'image-text', hotspot }),
  confirmTransfer: async (saveFirst = false) => {
    const transfer = get().pendingTransfer;
    if (!transfer) return;
    try {
      if (saveFirst && transfer.target === 'image-text') await useImageTextStore.getState().save();
      if (get().pendingTransfer !== transfer) return;
      commitTransfer(transfer);
      set({ pendingTransfer: null, error: null });
    } catch (error) { set({ error: error instanceof Error ? error.message : '转入创作失败，请重试。' }); }
  },
  cancelTransfer: () => set({ pendingTransfer: null }),
  resetSession: () => {
    requestVersion++; clearTimeout(refreshTimer); initializing = undefined;
    set({ hotspots: [], sources: [], isLoading: false, isRefreshing: false, lastFetchedAt: 0, error: null, analysisNotice: null, pendingTransfer: null });
  },
}), {
  name: 'video-remix-trending-v1',
  partialize: state => ({ profile: state.profile, lastContextSignature: state.lastContextSignature }),
}));

async function loadTrending(analyze: boolean, force: boolean): Promise<void> {
  clearTimeout(refreshTimer);
  const version = ++requestVersion;
  const state = useTrendingStore.getState();
  const signature = contextSignature();
  const { knowledgeDocs, keywords } = useAppStore.getState();
  useTrendingStore.setState({ isLoading: analyze || !state.hotspots.length, isRefreshing: !analyze && !!state.hotspots.length, error: null });
  try {
    let profile = state.profile;
    if (analyze) {
      const context = industryContext(knowledgeDocs, keywords);
      profile = context.docSnippets.length || context.keywords.length ? await detectIndustryProfile(knowledgeDocs, keywords) : null;
      if (version !== requestVersion) return;
    }
    const result = await fetchTrendingHotspots(profile, force, keywords.filter(k => k.category === 'forbidden').map(k => k.text), () => version === requestVersion);
    if (version !== requestVersion) return;
    useTrendingStore.setState({ profile, hotspots: result.hotspots, sources: result.sources, analysisNotice: result.analysisNotice || null,
      lastContextSignature: signature, lastFetchedAt: Date.now(),
      error: result.hotspots.length ? null : '当前没有可用热榜，请检查网络后刷新。' });
  } catch (error) {
    if (version === requestVersion) useTrendingStore.setState({ error: error instanceof Error ? error.message : '加载热点失败，请重试。' });
  } finally {
    if (version === requestVersion) useTrendingStore.setState({ isLoading: false, isRefreshing: false });
  }
}

function changeProfile(profile: IndustryProfile, force = false): void {
  requestVersion++; clearTimeout(refreshTimer); initializing = undefined;
  useTrendingStore.setState({ profile: { ...profile, isAutoDetected: false, analysisMethod: 'rules', lastUpdated: Date.now() },
    hotspots: [], lastFetchedAt: 0, activeFilterTab: 'recommended', searchQuery: '', onlyHighMatch: false,
    isLoading: true, isRefreshing: false, analysisNotice: null, error: null });
  refreshTimer = setTimeout(() => { void loadTrending(false, force); }, 300);
}
function transferBlocked(transfer: Transfer): string | null {
  const app = useAppStore.getState();
  if (transfer.target === 'workbench' && (app.isParsingVideo || app.isGeneratingScript)) return '视频工作台正在处理任务，请等待完成后再转入热点。';
  if (transfer.target === 'image-text' && useImageTextStore.getState().taskId) return '图文任务正在执行，请先取消或等待完成。';
  return null;
}
function requestTransfer(transfer: Transfer): void {
  const blocked = transferBlocked(transfer);
  if (blocked) { useTrendingStore.setState({ error: blocked }); return; }
  const app = useAppStore.getState();
  const needsConfirmation = transfer.target === 'workbench'
    ? !!(app.editedTranscript.trim() || app.editedVisualSummary.trim() || app.streamingScriptText.trim())
    : useImageTextStore.getState().hasUnsavedChanges();
  if (needsConfirmation) { useTrendingStore.setState({ pendingTransfer: transfer, error: null }); return; }
  try { commitTransfer(transfer); }
  catch (error) { useTrendingStore.setState({ error: error instanceof Error ? error.message : '转入创作失败。' }); }
}
function commitTransfer(transfer: Transfer): void {
  const blocked = transferBlocked(transfer);
  if (blocked) throw new Error(blocked);
  const { hotspot, target } = transfer;
  const app = useAppStore.getState();
  const source: ParsedVideoInfo = {
    platform: hotspot.platform, extractedUrl: hotspot.url || '', title: hotspot.title, author: hotspot.sourceName,
    durationSec: 0, transcript: `【热点话题】${hotspot.title}\n【二创切入角度】${hotspot.remixAngle}\n【开头钩子】${hotspot.suggestedHook || ''}`,
    visualSummary: '', suggestedCameraWork: '', contentKind: target === 'image-text' ? 'image-text' : 'video',
    sourceHotspot: { id: hotspot.id, platform: hotspot.platform, title: hotspot.title, url: hotspot.url, sourceName: hotspot.sourceName,
      sourceUpdatedAt: hotspot.sourceUpdatedAt, fetchedAt: hotspot.fetchedAt, remixAngle: hotspot.remixAngle, suggestedHook: hotspot.suggestedHook,
      industryProfile: useTrendingStore.getState().profile ? structuredClone(useTrendingStore.getState().profile!) : undefined },
  };
  if (target === 'workbench') { app.setParsedVideo(source); app.setLinkInput(''); }
  else useImageTextStore.getState().begin(source, 'manual');
  app.setActiveNav(target);
}
