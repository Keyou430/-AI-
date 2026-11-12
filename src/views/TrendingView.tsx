import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import { useTrendingStore } from '../store/useTrendingStore';
import { useAppStore } from '../store/useAppStore';
import { DEFAULT_PROFILES, industryContext } from '../services/trendingService';
import { HotspotCard } from '../components/trending/HotspotCard';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { formatDateTime } from '../lib/utils';
import { PLATFORM_LABELS, TRENDING_PLATFORMS, type TrendingFilterTab } from '../../electron/services/trendingTypes';

const TEMPLATES = [
  ['new_energy', '新能源 / 智能出行'], ['decoration', '家居家装 / 全屋定制'], ['tech', '数码科技 / AI'],
  ['health', '大健康 / 养生滋补'], ['beauty', '美妆个护'], ['food', '餐饮美食'], ['general', '综合商业'],
];
const TABS: Array<{ id: TrendingFilterTab; label: string }> = [
  { id: 'recommended', label: '行业推荐' },
  ...TRENDING_PLATFORMS.map(id => ({ id, label: PLATFORM_LABELS[id] })),
];
export const TrendingView: React.FC = () => {
  const state = useTrendingStore();
  const docs = useAppStore(s => s.knowledgeDocs);
  const keywords = useAppStore(s => s.keywords);
  const contextKey = JSON.stringify({ ...industryContext(docs, keywords), forbidden: keywords.filter(k => k.category === 'forbidden').map(k => k.text) });
  const [tag, setTag] = useState('');
  const [editingTags, setEditingTags] = useState(false);
  const [saving, setSaving] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { void state.init(); }, [state.init, contextKey]);
  const busy = state.isLoading || state.isRefreshing;
  const unavailableSource = state.sources.find(source => source.platform === state.activeFilterTab && source.status === 'unavailable');
  const selectedTemplate = state.profile && !state.profile.isAutoDetected
    ? TEMPLATES.find(([key]) => DEFAULT_PROFILES[key].primaryIndustry === state.profile?.primaryIndustry &&
      JSON.stringify(DEFAULT_PROFILES[key].subCategories) === JSON.stringify(state.profile?.subCategories))?.[0] || ''
    : '';
  const list = useMemo(() => state.hotspots.filter(item => {
    const source = state.sources.find(s => s.platform === item.platform);
    if (state.activeFilterTab === 'recommended' && (!state.profile || item.relevanceScore < 60 || source?.status !== 'fresh')) return false;
    if (state.activeFilterTab !== 'recommended' && state.activeFilterTab !== 'all' && item.platform !== state.activeFilterTab) return false;
    if (state.onlyHighMatch && !item.isHighMatch) return false;
    const query = state.searchQuery.trim().toLowerCase();
    return !query || [item.title, item.remixAngle, ...item.matchKeywords].some(text => text.toLowerCase().includes(query));
  }), [state.hotspots, state.sources, state.profile, state.activeFilterTab, state.onlyHighMatch, state.searchQuery]);
  const confirm = async (saveFirst = false) => {
    setSaving(true);
    try { await state.confirmTransfer(saveFirst); } finally { setSaving(false); }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background" data-testid="trending-view">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-4 md:px-6">
        <h1 className="text-sm font-semibold">行业热点</h1>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <Button size="sm" variant={state.activeFilterTab === 'all' ? 'secondary' : 'ghost'}
              aria-pressed={state.activeFilterTab === 'all'} onClick={() => state.setFilterTab('all')}>全部</Button>
            <label className="sr-only" htmlFor="trending-template">选择行业预设</label>
            <select id="trending-template" value={selectedTemplate} className="h-9 min-w-0 max-w-full rounded-md border bg-background px-2 text-xs"
              onChange={event => { setTag(''); setEditingTags(false); state.selectProfileTemplate(event.target.value); }}>
              <option value="" disabled>{state.profile ? (state.profile.isAutoDetected ? '已分析行业' : '自定义行业') : '选择行业预设'}</option>
              {TEMPLATES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void state.reanalyze()}>
            重新分析行业
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void state.refresh(true)}>
            <RefreshCw className={busy ? 'animate-spin' : ''} />刷新热榜
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        <section className="surface space-y-3 p-4" aria-label="行业画像">
          {state.profile ? <>
            <p className="text-sm font-medium">{state.profile.primaryIndustry}</p>
            <p className="muted-copy">{state.profile.isAutoDetected ? (state.profile.analysisMethod === 'ai' ? 'AI 分析' : '规则分析') : '手动行业'} · 已启用 {docs.filter(d => d.enabled).length} 份知识库</p>
            <details open={editingTags} onToggle={event => setEditingTags(event.currentTarget.open)}>
              <summary className="w-fit cursor-pointer text-xs text-muted-foreground">调整行业标签</summary>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {state.profile.subCategories.map(value => <span key={value} className="flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs">
                  {value}<button type="button" aria-label={'移除行业标签 ' + value} onClick={() => state.removeCategoryTag(value)}><X className="h-3 w-3" /></button>
                </span>)}
                <label className="sr-only" htmlFor="trending-tag">新增行业标签</label>
                <input id="trending-tag" value={tag} maxLength={100} placeholder="新增行业标签" className="h-8 w-36 rounded-md border bg-background px-2 text-xs"
                  onChange={event => setTag(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && tag.trim()) { state.addCategoryTag(tag); setTag(''); } }} />
                <Button size="sm" variant="ghost" disabled={!tag.trim() || state.profile.subCategories.length >= 8}
                  aria-label="添加行业标签" onClick={() => { state.addCategoryTag(tag); setTag(''); }}><Plus /></Button>
              </div>
            </details>
          </> : <p className="text-sm">先选择行业预设，或在设置中添加知识库和业务关键词，获取行业推荐。当前可浏览平台热榜。</p>}
          <p className="muted-copy">匹配分用于选题排序；话题与热度来自聚合数据源，创作前请查看来源核实背景。</p>
        </section>
        {state.error && <p role="alert" className="status-note text-destructive">{state.error}</p>}
        {state.analysisNotice && <p role="status" className="status-note">{state.analysisNotice}</p>}
        <section aria-label="热榜数据来源" className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {state.sources.map(source => <div key={source.platform} className="surface min-w-0 space-y-1 p-3 text-xs">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
              <span>{PLATFORM_LABELS[source.platform]}</span>
              <span className={source.status === 'fresh' ? 'text-muted-foreground' : 'text-warning'}>{source.status === 'fresh' ? (source.cached ? '本机缓存' : '已获取') : source.status === 'stale' ? (source.refreshFailed ? '刷新失败' : '来源过期') : '暂不可用'}</span>
            </p>
            <p className="flex items-center justify-between gap-2 text-muted-foreground">
              <span className="min-w-0 truncate" title={source.sourceName}>{source.sourceName}</span><span className="shrink-0">{source.count} 条</span>
            </p>
            {source.sourceUpdatedAt && <p className="text-muted-foreground">更新：{formatDateTime(new Date(source.sourceUpdatedAt).toISOString())}</p>}
            {source.message && <details className="text-warning">
              <summary className="w-fit cursor-pointer">查看原因</summary>
              <p className="mt-1 break-words">{source.message}</p>
            </details>}
          </div>)}
        </section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1" aria-label="热点平台筛选">
            {TABS.map(tab => <Button key={tab.id} size="sm" variant={state.activeFilterTab === tab.id ? 'secondary' : 'ghost'}
              aria-pressed={state.activeFilterTab === tab.id} onClick={() => state.setFilterTab(tab.id)}>{tab.label}</Button>)}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={state.onlyHighMatch} onChange={event => state.setOnlyHighMatch(event.target.checked)} />仅看高契合</label>
            <div className="relative"><Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <label className="sr-only" htmlFor="trending-search">搜索热点</label>
              <input id="trending-search" value={state.searchQuery} onChange={event => state.setSearchQuery(event.target.value)}
                placeholder="搜索话题、切入点" className="h-9 w-48 rounded-md border bg-background pl-7 pr-2" />
            </div>
          </div>
        </div>
        {state.profile && <p className="text-xs text-muted-foreground">行业推荐按当前行业筛选；“全部”和平台页可浏览完整热榜。</p>}
        {busy && <p role="status" className="status-note">正在获取热榜并匹配行业，请稍候…</p>}
        {!busy && !list.length && <p role="status" className="surface p-6 text-sm text-muted-foreground">{unavailableSource?.message || '没有符合条件的话题。可切换“全部”、调整筛选，或刷新重试；行业推荐仅展示未过期且匹配分达到 60 的话题。'}</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="trending-results">
          {list.map(item => <HotspotCard key={item.id} item={item} stale={state.sources.find(s => s.platform === item.platform)?.status !== 'fresh'} />)}
        </div>
      </div>
      <Modal open={!!state.pendingTransfer} onOpenChange={open => { if (!open) state.cancelTransfer(); }} busy={saving}
        title="替换当前创作内容？" description="目标工作台有未保存的内容，继续会替换当前编辑稿。请先保存需要保留的内容。" initialFocus={cancelRef}
        footer={<><Button ref={cancelRef} variant="secondary" disabled={saving} onClick={state.cancelTransfer}>取消</Button>
          {state.pendingTransfer?.target === 'image-text' && <Button variant="secondary" disabled={saving} onClick={() => void confirm(true)}>保存后转入</Button>}
          <Button disabled={saving} onClick={() => void confirm()}>放弃当前稿并转入</Button></>}>
        <p className="text-sm">{state.pendingTransfer?.hotspot.title}</p>
        {state.error && <p role="alert" className="mt-3 text-sm text-destructive">{state.error}</p>}
      </Modal>
    </div>
  );
};
