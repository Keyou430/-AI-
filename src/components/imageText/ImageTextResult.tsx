import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, WandSparkles } from 'lucide-react';
import { Button } from '../ui/Button';
import { isImagePageReviewed } from '../../../electron/services/imageTextReview';
import { pageRenderKey } from '../../../electron/services/imageTextModel';
import type { ImageTextDraft } from '../../../electron/services/imageTextTypes';
import '../../services/ipcClient';

export function ImageAssetPreview({ id, alt, className = 'max-h-[65vh]', style }: { id?: string; alt: string; className?: string; style?: CSSProperties }) {
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; setImage(null); setError('');
    if (id) void window.electronAPI?.readImageTextAsset(id).then(result => {
      if (!active) return;
      if (result.success && result.data) setImage({ id, url: result.data });
      else setError(result.error || '图片读取失败，请检查本机存储。');
    }).catch(() => { if (active) setError('图片读取失败，请检查本机存储。'); });
    return () => { active = false; };
  }, [id]);
  return image && image.id === id ? <img src={image.url} alt={alt} style={style} className={className + ' w-full object-contain'} />
    : <p role="status" className="p-8 text-center text-sm text-muted-foreground">{error || (id ? '正在读取图片…' : '确认后将在这里生成图片')}</p>;
}
export function ImageTextResult({ draft, activePageId, onSelect, onOptimize, onVersion, onReview, busy = false, showPublication = false }: {
  draft: ImageTextDraft; activePageId: string | null; onSelect: (id: string) => void;
  onOptimize?: (id: string) => void; onVersion?: (pageId: string,versionId:string) => void; onReview?: (pageId:string,reviewed:boolean) => void; busy?: boolean;
  showPublication?: boolean;
}) {
  const index = Math.max(0, draft.pages.findIndex(p => p.id === activePageId));
  const page = draft.pages[index];
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const wide = size.width >= 520;
  const showDetails = !!(onOptimize || showPublication || onVersion || onReview);
  return <div ref={container} className="flex min-h-0 min-w-0 flex-1 flex-col" tabIndex={draft.pages.length > 1 ? 0 : undefined} aria-label="图片预览与翻页" onKeyDown={event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
    const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1 : -1;
    if (next >= 0 && next < draft.pages.length) { event.preventDefault(); onSelect(draft.pages[next].id); }
  }}>
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
      {page && <>
        <p className="muted-copy">整套比例 {draft.ratio} · {page.assetId && page.renderedKey === pageRenderKey(draft, page) ? '已生成' : page.assetId ? '内容已更新，等待重生成' : '尚未生成'}</p>
        {onOptimize && <Button size="sm" disabled={busy} onClick={() => onOptimize(page.id)}><WandSparkles />图片优化</Button>}
      </>}
    </div>
    <div className="min-h-0 flex-1 overflow-hidden p-3" data-testid="image-text-result-scroll">
      {page ? <div className={wide && showDetails ? 'grid h-full min-h-0 gap-4 grid-cols-[minmax(0,1fr)_minmax(220px,.7fr)]' : 'flex h-full min-h-0 flex-col gap-3'}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden" data-testid="image-text-image-column">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border bg-muted/30" data-testid="image-text-preview">
            {page.assetId ? <ImageAssetPreview id={page.assetId} alt={'第 ' + (index + 1) + ' 张图文：' + page.text} className="h-full min-h-0 max-h-full" /> : <div className="max-h-full space-y-2 overflow-y-auto p-4 text-center">
              <p className="reading-text">{page.text || '本图文字待填写'}</p>
              <p className="muted-copy">确认后将在这里生成图片。{draft.ratioOrigin} 此处确认前不会调用生图接口；确认后无需逐页确认。</p>
            </div>}
          </div>
          {draft.pages.length > 1 && <div className="flex shrink-0 items-center justify-center gap-2" aria-label="图片分页">
            <Button size="sm" disabled={index <= 0} onClick={() => onSelect(draft.pages[index - 1].id)}><ChevronLeft />上一图</Button>
            <label className="min-w-0 text-xs"><span className="sr-only">当前图片</span>
              <select aria-label="选择图片" className="field inline-block w-auto min-w-0" value={page.id} onChange={event => onSelect(event.target.value)}>
                {draft.pages.map((p, i) => <option key={p.id} value={p.id}>第 {i + 1} / {draft.pages.length} 图</option>)}
              </select>
            </label>
            <Button size="sm" disabled={index >= draft.pages.length - 1} onClick={() => onSelect(draft.pages[index + 1].id)}>下一图<ChevronRight /></Button>
          </div>}
        </div>
        {showDetails && <div className={'min-h-0 min-w-0 space-y-3 overflow-y-auto ' + (wide ? '' : 'max-h-[45%] shrink-0')} data-testid="image-text-detail-scroll">
          {showPublication && <div className="space-y-3">
            <h2 className="section-title">{draft.title}</h2><p className="reading-text">{draft.body}</p>
            <p className="muted-copy">{draft.tags.map(t => '#' + t.replace(/^#+/, '')).join(' ')}</p>
          </div>}
          <details key={page.id} className="disclosure" open={page.error ? true : undefined}>
            <summary>本图文字与画面要求</summary>
            <div className="mt-3 space-y-2"><p className="reading-text">{page.text}</p><p className="muted-copy whitespace-pre-wrap">画面：{page.visual}</p></div>
          </details>
          {onVersion && <label className="block text-xs">页面版本<select aria-label="页面版本" disabled={busy} className="field mt-1.5" value={page.currentVersionId || ''} onChange={e => onVersion(page.id,e.target.value)}>
            {!page.currentVersionId && <option value="">尚无成功版本</option>}
            {(draft.versions || []).filter(v => v.pageId === page.id).map((v,i) => <option key={v.id} value={v.id}>{i+1} · {new Date(v.createdAt).toLocaleString()} · {v.text.slice(0,24)} · {v.visual.slice(0,20)}</option>)}
          </select></label>}
          {onReview && <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={busy || !page.currentVersionId || !!page.error || page.renderedKey !== pageRenderKey(draft,page)} checked={isImagePageReviewed(draft,page)} onChange={e => onReview(page.id,e.target.checked)} />图内文字已核对（重生成或切换版本后清除）</label>}
          {page.error && <p role="alert" className="text-sm text-destructive">{page.error}</p>}
        </div>}
      </div> : <p className="muted-copy p-6 text-center">等待文案与分页草案</p>}
    </div>
  </div>;
}
