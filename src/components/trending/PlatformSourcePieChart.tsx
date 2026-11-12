import { useState } from 'react';
import type { HotspotPlatformStatus, TrendingFilterTab, TrendingPlatform } from '../../../electron/services/trendingTypes';
import { PLATFORM_LABELS } from '../../../electron/services/trendingTypes';
import { cn, formatDateTime } from '../../lib/utils';

const PLATFORM_COLORS: Record<TrendingPlatform, string> = {
  douyin: 'hsl(245 62% 52%)',
  xiaohongshu: 'hsl(348 75% 48%)',
  weibo: 'hsl(28 88% 46%)',
  zhihu: 'hsl(218 76% 48%)',
  toutiao: 'hsl(155 62% 36%)',
  wechat_channels: 'hsl(240 8% 62%)',
};

function sourceStatus(source: HotspotPlatformStatus) {
  return source.status === 'fresh' ? (source.cached ? '本机缓存' : '已获取')
    : source.status === 'stale' ? (source.refreshFailed ? '刷新失败' : '来源过期') : '暂不可用';
}

export function PlatformSourcePieChart({ sources, activeTab, onSelectPlatform }: {
  sources: HotspotPlatformStatus[];
  activeTab: TrendingFilterTab;
  onSelectPlatform: (platform: TrendingPlatform) => void;
}) {
  const [hoveredPlatform, setHoveredPlatform] = useState<TrendingPlatform | null>(null);
  const totalCount = sources.reduce((sum, source) => sum + Math.max(0, source.count), 0);
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  let accumulatedLength = 0;
  const segments = sources.filter(source => source.count > 0).map(source => {
    const ratio = source.count / totalCount;
    const length = ratio * circumference;
    const offset = -accumulatedLength;
    accumulatedLength += length;
    return { ...source, ratio, length, offset };
  });
  const highlightedPlatform = hoveredPlatform ?? activeTab;
  const highlightedSource = sources.find(source => source.platform === highlightedPlatform);
  const issueCount = sources.filter(source => source.status !== 'fresh').length;
  return <section aria-label="热榜数据来源" className="min-w-0 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
    <h2 className="mb-2 text-xs font-semibold">平台数据占比 <span className="ml-1 font-normal text-muted-foreground">按已获取条数</span></h2>
    <div className="flex items-center gap-3 sm:gap-4">
      <div className="relative h-24 w-24 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90 overflow-visible" role="group" aria-label={'平台数据占比，共 ' + totalCount + ' 条'}>
          <circle cx="50" cy="50" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="14" />
          {segments.map(segment => <circle key={segment.platform} cx="50" cy="50" r={radius} fill="none"
            stroke={PLATFORM_COLORS[segment.platform]} strokeWidth={highlightedPlatform === segment.platform ? 17 : 14}
            strokeDasharray={segment.length + ' ' + (circumference - segment.length)} strokeDashoffset={segment.offset}
            className="cursor-pointer transition-[stroke-width,opacity] duration-150" role="button" tabIndex={0}
            aria-label={PLATFORM_LABELS[segment.platform] + '：' + segment.count + ' 条，占比 ' + Math.round(segment.ratio * 100) + '%，' + sourceStatus(segment)}
            aria-pressed={activeTab === segment.platform}
            onMouseEnter={() => setHoveredPlatform(segment.platform)} onMouseLeave={() => setHoveredPlatform(null)}
            onFocus={() => setHoveredPlatform(segment.platform)} onBlur={() => setHoveredPlatform(null)}
            onClick={() => onSelectPlatform(segment.platform)} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectPlatform(segment.platform); }
            }}>
            <title>{PLATFORM_LABELS[segment.platform]}：{segment.count} 条（{Math.round(segment.ratio * 100)}%）</title>
          </circle>)}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden="true">
          <span className="text-lg font-semibold tabular-nums">{highlightedSource?.count ?? totalCount}</span>
          <span className="text-[10px] text-muted-foreground">{highlightedSource ? PLATFORM_LABELS[highlightedSource.platform] : '总条数'}</span>
        </div>
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3" data-testid="platform-source-legend">
        {sources.map(source => <button key={source.platform} type="button" data-platform={source.platform}
          aria-label={'筛选' + PLATFORM_LABELS[source.platform] + '，' + source.count + ' 条，' + sourceStatus(source)}
          aria-pressed={activeTab === source.platform} onClick={() => onSelectPlatform(source.platform)}
          onMouseEnter={() => setHoveredPlatform(source.platform)} onMouseLeave={() => setHoveredPlatform(null)}
          onFocus={() => setHoveredPlatform(source.platform)} onBlur={() => setHoveredPlatform(null)}
          className={cn('min-h-11 min-w-0 rounded-md border px-2 py-1.5 text-left text-[11px] transition-[border-color,background-color,box-shadow] duration-150',
            activeTab === source.platform ? 'border-primary/45 bg-accent shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.18)]'
              : 'border-border/70 bg-background/50 hover:border-primary/25 hover:bg-muted')}>
          <span className="flex min-w-0 items-center gap-1 font-medium"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[source.platform] }} aria-hidden="true" /><span className="truncate">{PLATFORM_LABELS[source.platform]}</span><span className="ml-auto shrink-0 tabular-nums">{source.count}</span></span>
          <span className={cn('mt-0.5 block text-[10px]', source.status === 'fresh' ? 'text-muted-foreground' : 'text-warning')}>{sourceStatus(source)}</span>
        </button>)}
      </div>
    </div>
    {!sources.length && <p className="mt-2 muted-copy">刷新后显示平台分布。</p>}
    {!!sources.length && <details className="mt-2 text-[11px]">
      <summary className="w-fit cursor-pointer rounded px-1 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">来源详情{issueCount > 0 && <span className="ml-2 text-warning">{issueCount} 项异常／不可用</span>}</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="platform-source-details">
        {sources.map(source => <div key={source.platform} className="min-w-0 rounded-md border bg-background/60 p-2">
          <p className="font-medium">{PLATFORM_LABELS[source.platform]} · {source.count} 条 · {sourceStatus(source)}</p>
          <p className="mt-1 break-words text-muted-foreground">{source.sourceName}</p>
          {source.sourceUpdatedAt && <p className="text-muted-foreground">更新：{formatDateTime(new Date(source.sourceUpdatedAt).toISOString())}</p>}
          {source.message && <p className="mt-1 break-words text-warning">{source.message}</p>}
        </div>)}
      </div>
    </details>}
  </section>;
}
