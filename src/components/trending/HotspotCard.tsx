import React from 'react';
import { ExternalLink, Film, Images, Flame } from 'lucide-react';
import type { HotspotItem } from '../../types/trending';
import { PLATFORM_LABELS } from '../../../electron/services/trendingTypes';
import { Button } from '../ui/Button';
import { notifyError } from '../ui/Toast';
import { useTrendingStore } from '../../store/useTrendingStore';
import { openExternalClient } from '../../services/ipcClient';
import { cn, formatDateTime } from '../../lib/utils';

export const HotspotCard: React.FC<{ item: HotspotItem; stale?: boolean }> = ({ item, stale }) => {
  const transferToWorkbench = useTrendingStore(s => s.transferToWorkbench);
  const transferToImageText = useTrendingStore(s => s.transferToImageText);
  const openSource = async () => {
    try { if (!item.url || !await openExternalClient(item.url)) notifyError('打开来源失败，请稍后重试。'); }
    catch { notifyError('打开来源失败，请稍后重试。'); }
  };
  return <article className="surface flex min-w-0 flex-col justify-between gap-3 p-4 transition-[border-color,box-shadow] duration-150 hover:border-foreground/50 hover:shadow-[0_3px_10px_hsl(var(--foreground)/0.06)] focus-within:border-foreground" data-testid="hotspot-card">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        {item.rank > 0 && item.rank <= 3 && <span className={cn('inline-flex h-6 min-w-6 items-center justify-center rounded-sm px-1 font-mono text-[11px] tabular-nums', item.rank === 1 ? 'bg-primary text-primary-foreground' : item.rank === 2 ? 'bg-foreground text-card' : 'bg-secondary text-foreground')} aria-label={'平台排名第 ' + item.rank + ' 名'}>{String(item.rank).padStart(2, '0')}</span>}
        <span className="inline-flex items-center justify-center rounded-md bg-surface-muted px-2 py-1 font-medium text-muted-foreground">{PLATFORM_LABELS[item.platform]}</span>
        <span className="inline-flex items-center gap-1 tabular-nums"><Flame className="h-3 w-3 text-muted-foreground" aria-hidden="true" />热度 {item.heatScore}</span>
      </div>
      <span className={cn('inline-flex items-center gap-1.5 border-l border-input pl-2 text-[11px] tabular-nums', item.isHighMatch ? 'font-semibold text-foreground' : 'text-muted-foreground')}><span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', item.isHighMatch ? 'bg-primary' : 'bg-input')} />{item.analysisMethod === 'ai' ? 'AI 匹配分' : '规则匹配分'} {item.relevanceScore}</span>
    </div>
    <h2 className="break-words text-balance text-sm font-semibold leading-relaxed">{item.title}</h2>
    <p className="text-[11px] leading-relaxed tabular-nums text-muted-foreground">{item.sourceName} · {formatDateTime(new Date(item.sourceUpdatedAt).toISOString())}{stale ? ' · 暂非最新数据，仅供参考' : ''}</p>
    {!!item.matchKeywords.length && <p className="text-xs text-muted-foreground">关联词：{item.matchKeywords.join('、')}</p>}
    {item.remixAngle && <div className="space-y-2 rounded-md border border-input bg-secondary/40 p-3 text-xs leading-relaxed">
      <p className="border-b border-input pb-2 text-[10px] font-medium tracking-wider text-muted-foreground">二创切入点</p>
      <p>{item.remixAngle}</p>
      {item.suggestedHook && <p>开头钩子：{item.suggestedHook}</p>}
    </div>}
    <div className="grid grid-cols-3 items-center gap-1 border-t pt-3" data-testid="hotspot-actions">
      <Button size="sm" className="min-w-0 gap-1 px-1 text-[11px] [&_svg]:h-3 [&_svg]:w-3" variant="ghost" disabled={!item.url} onClick={() => void openSource()}><ExternalLink />查看话题</Button>
      <Button size="sm" className="min-w-0 gap-1 px-1 text-[11px] [&_svg]:h-3 [&_svg]:w-3" variant="secondary" onClick={() => transferToWorkbench(item)} title="预填热点背景，进入工作台后点击生成脚本"><Film />转视频二创</Button>
      <Button size="sm" className="min-w-0 gap-1 px-1 text-[11px] [&_svg]:h-3 [&_svg]:w-3" onClick={() => transferToImageText(item)} title="调用文本模型策划图文草案，确认后再生成图片"><Images />转图文策划</Button>
    </div>
  </article>;
};
