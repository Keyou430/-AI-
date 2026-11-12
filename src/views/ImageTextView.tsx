import { useEffect, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Menu } from '@base-ui/react/menu';
import { ClipboardPaste, Download, LoaderCircle, Plus, Save, WandSparkles, X, NotebookPen, Images } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useImageTextStore } from '../store/useImageTextStore';
import { extractAndRoute } from '../services/contentExtraction';
import { getVideoLinkError } from '../../electron/services/videoLink';
import { optimizationImpact, removeImageReference } from '../../electron/services/imageTextReview';
import { ImageTextStyleCardEditor } from '../components/imageText/ImageTextReviewPanel';
import { affectedPages, publicationText } from '../../electron/services/imageTextModel';
import { IMAGE_RATIOS, type ImageTextDraft, type ImageReference } from '../../electron/services/imageTextTypes';
import type { ImageProtocol } from '../../electron/services/providerTypes';
import { ImageTextReferences } from '../components/imageText/ImageTextReferences';
import { ImageTextResult } from '../components/imageText/ImageTextResult';
import { ExtractedContentDetails } from '../components/ExtractedContentDetails';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { notifyError, notifySuccess } from '../components/ui/Toast';
import { creationGrid, cn } from '../lib/utils';

const planTabs = ['copy', 'pages', 'style', 'assets'] as const;
const confirmedTabs = ['publish', 'assets'] as const;
type ImageTextTab = (typeof planTabs)[number] | (typeof confirmedTabs)[number];

function TextField({ label, value, onChange, rows = 3, disabled = false, testId }: {
  label: string; value: string; onChange: (value: string) => void; rows?: number; disabled?: boolean; testId?: string;
}) {
  return <label className="block text-xs font-medium">{label}<textarea data-testid={testId} className="field mt-1.5 resize-y" rows={rows} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} /></label>;
}
function TagsField({ tags, onChange, disabled = false }: { tags: string[]; onChange: (tags: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState(tags.join(' '));
  useEffect(() => { setText(current => current.split(/\s+/).filter(Boolean).join(' ') === tags.join(' ') ? current : tags.join(' ')); }, [tags]);
  return <label className="block text-xs font-medium">话题（空格分隔）<textarea className="field mt-1.5 resize-y" rows={2} value={text} disabled={disabled}
    onChange={event => { setText(event.target.value); onChange(event.target.value.split(/\s+/).filter(Boolean)); }} /></label>;
}
export function ImageTextView() {
  const state = useImageTextStore();
  const { draft, taskId, activePageId } = state;
  const busy = !!taskId;
  const parsing = useAppStore(s => s.isParsingVideo);
  const [imageProtocol, setImageProtocol] = useState<ImageProtocol | null>(null);
  const supportsImageReferences = imageProtocol !== null && imageProtocol !== 'glm';
  const [link, setLink] = useState('');
  const [localError, setLocalError] = useState('');
  const [optimization, setOptimization] = useState<{ draft: ImageTextDraft; pageId?: string } | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [usePrevious, setUsePrevious] = useState<boolean | null>(null);
  const [instruction, setInstruction] = useState('');
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<ImageTextTab>('copy');
  const [mobileStep, setMobileStep] = useState<'plan' | 'result'>('plan');
  const planScroll = useRef<HTMLDivElement>(null);
  const tabs = draft?.confirmed ? confirmedTabs : planTabs;
  const activeTab = tabs.some(value => value === tab) ? tab : draft?.confirmed ? 'publish' : 'copy';
  useEffect(() => {
    setTab(draft?.confirmed ? 'publish' : 'copy');
    setMobileStep(draft?.confirmed ? 'result' : 'plan');
    if (planScroll.current) planScroll.current.scrollTop = 0;
  }, [draft?.id, draft?.confirmed]);
  useEffect(() => {
    let active = true;
    void window.electronAPI?.getProviderSettings().then(result => {
      if (!active) return;
      if (result.success && result.config) setImageProtocol(result.config.imageProtocol || 'agnes');
      else setLocalError(result.error || '读取图片生成配置失败，请重新进入图文页面后重试。');
    }).catch(() => { if (active) setLocalError('读取图片生成配置失败，请重新进入图文页面后重试。'); });
    return () => { active = false; };
  }, []);
  const page = draft?.pages.find(p => p.id === activePageId) || draft?.pages[0];
  const report = (error: unknown) => { const message = error instanceof Error ? error.message : '图文操作失败，请重试。'; setLocalError(message); notifyError(message); };
  const extract = async () => {
    const error = getVideoLinkError(link); if (error) { setLocalError(error); return; }
    setLocalError('');
    try { await extractAndRoute(link); } catch (error) { report(error); }
  };
  const startOptimize = (pageId?: string) => {
    if (!draft || busy || uploading) return;
    if (imageProtocol === null) { report(new Error('尚未读取图片生成配置，请稍后重试；若持续失败，请重新进入图文页面。')); return; }
    setOptimization({ draft: structuredClone(draft), pageId }); setInstruction(''); setPreviewReady(false); setUsePrevious(null); setLocalError('');
  };
  const uploadOptimizationReference = async () => {
    if (!optimization || uploading) return;
    const original = optimization;
    setUploading(true);
    try {
      const currentDraft = useImageTextStore.getState().draft;
      if (!currentDraft || currentDraft.id !== original.draft.id) return;
      const result = await window.electronAPI?.selectImageTextReferences('scene', structuredClone(currentDraft));
      if (result?.canceled) return;
      if (!result?.success || !result.data) throw new Error(result?.error || '参考图导入失败。');
      const refs = result.data;
      const currentDraftAfterImport = useImageTextStore.getState().draft;
      if (currentDraftAfterImport?.id === currentDraft.id) {
        useImageTextStore.setState({ draft: { ...currentDraftAfterImport, references: [...currentDraftAfterImport.references, ...refs] } });
      }
      setOptimization(current => current === original ? { ...original, draft: { ...original.draft, references: [...original.draft.references, ...refs],
        pages: original.draft.pages.map(p => supportsImageReferences && p.id === original.pageId ? { ...p, referenceIds: [...p.referenceIds, ...refs.map(r => r.id)] } : p) } } : current);
    } catch (error) { report(error); } finally { setUploading(false); }
  };
  const addReferences = async (kind: ImageReference['kind']) => {
    if (busy || uploading) return;
    setUploading(true);
    try { await state.addReferences(kind); } finally { setUploading(false); }
  };
  const removeReference = async (id: string) => {
    if (busy || uploading) return;
    setUploading(true);
    try {
      await state.removeReference(id);
      setOptimization(current => current ? { ...current, draft: removeImageReference(current.draft,id) } : current);
    } catch (error) { report(error); } finally { setUploading(false); }
  };
  const submitOptimization = async () => {
    if (!optimization || busy || uploading) return;
    if (!optimization.pageId && instruction.trim() && !previewReady) {
      try { const preview = await state.previewOptimization(optimization.draft,instruction.trim()); setOptimization({draft:preview}); setPreviewReady(true); }
      catch(error) { report(error); } return;
    }
    const { draft: edited, pageId } = optimization;
    useImageTextStore.setState({ draft: edited, activePageId: pageId || activePageId, error: null });
    setOptimization(null);
    await state.generate(pageId,pageId ? previousDefault : false);
  };
  const optimizedPage = optimization?.draft.pages.find(p => p.id === optimization.pageId);
  const originalPage = draft?.pages.find(p => p.id === optimization?.pageId);
  const previousDefault = supportsImageReferences && (usePrevious ?? (!!originalPage?.assetId && optimizedPage?.text !== originalPage.text && optimizedPage?.visual === originalPage.visual && JSON.stringify(optimizedPage?.referenceIds) === JSON.stringify(originalPage.referenceIds)));
  const impact = optimization ? optimizationImpact(optimization.draft).filter(item => !optimization.pageId || item.pageId === optimization.pageId) : [];
  const patchOptimization = (patch: Partial<ImageTextDraft>) => setOptimization(current => current ? { ...current, draft: { ...current.draft, ...patch } } : current);
  const patchOptimizedPage = (patch: { text?: string; visual?: string; referenceIds?: string[] }) => setOptimization(current => current ? { ...current,
    draft: { ...current.draft, pages: current.draft.pages.map(p => p.id === current.pageId ? { ...p, ...patch } : p) } } : current);
  const referenceOptions = (references: ImageReference[], selected: string[], change: (ids: string[]) => void) => references.filter(r => r.kind === 'scene').map(ref =>
    <label className="flex items-center gap-2 text-xs" key={ref.id}><input type="checkbox" checked={selected.includes(ref.id)} disabled={!supportsImageReferences && !selected.includes(ref.id)} onChange={e => change(e.target.checked ? [...selected, ref.id] : selected.filter(id => id !== ref.id))} />{ref.name} · 保留关键外观</label>);
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
    <header className="shrink-0 space-y-2 border-b bg-card px-4 py-3 md:px-6">
      <div className="flex items-center gap-3 overflow-x-auto" data-testid="image-text-topbar">
        <h1 className="shrink-0 whitespace-nowrap text-sm font-semibold">小红书图文二创</h1>
        <form className="flex min-w-64 flex-1 items-center gap-2" onSubmit={e => { e.preventDefault(); void extract(); }}>
          <label className="sr-only" htmlFor="image-text-link">小红书分享链接</label>
          <input id="image-text-link" value={link} onChange={e => setLink(e.target.value)} disabled={busy || uploading || parsing} className="field min-w-0 flex-1" placeholder="粘贴小红书分享链接" />
          <Button size="sm" disabled={busy || uploading || parsing} aria-label="粘贴分享链接" onClick={() => { void navigator.clipboard.readText().then(setLink).catch(() => report(new Error('无法读取剪贴板，请使用 Ctrl+V。'))); }}><ClipboardPaste />粘贴</Button>
          <Button type="submit" size="sm" variant="primary" disabled={busy || uploading || parsing}>{parsing ? '提取中…' : '提取并继续'}</Button>
        </form>
        {draft && <div className="flex shrink-0 gap-2">
          <Button size="sm" disabled={busy || uploading || saving} onClick={async () => { setSaving(true); try { await state.save(); notifySuccess('图文历史已保存'); } catch (error) { report(error); } finally { setSaving(false); } }}><Save />保存</Button>
          {draft.confirmed && <Button size="sm" disabled={busy || uploading} onClick={() => startOptimize()}><WandSparkles />全局优化</Button>}
          <Button size="sm" disabled={busy || uploading || exporting || !draft.pages.length} onClick={async () => {
            setExporting(true); try { const result = await window.electronAPI?.exportImageText(draft,useAppStore.getState().keywords.filter(k => k.category === 'forbidden').map(k => k.text));
              if (result?.canceled) return; if (!result?.success) throw new Error(result?.error || '导出失败。'); notifySuccess('素材包已导出到 ' + result.data);
            } catch (error) { report(error); } finally { setExporting(false); }
          }}><Download />导出素材包</Button>
        </div>}
      </div>
      {(state.error || localError) && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{state.error || localError}</p>}
      {state.progress && <div role="status" className="status-note items-center">{busy && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />}<span className="min-w-0 flex-1">{state.progress}</span>{busy && <Button size="sm" onClick={() => { void state.cancel(); }}>取消任务</Button>}</div>}
      {draft?.confirmed && affectedPages(draft).length > 0 && <Button size="sm" disabled={busy || uploading} onClick={() => { void state.generate(); }}>继续／重试 {affectedPages(draft).length} 张未完成图片</Button>}
    </header>
    <div className="flex shrink-0 gap-1 border-b bg-card px-4 py-2 lg:hidden" aria-label="工作区切换">
      <Button size="sm" variant={mobileStep === 'plan' ? 'secondary' : 'ghost'} aria-pressed={mobileStep === 'plan'} aria-controls="image-text-plan" onClick={() => setMobileStep('plan')}>策划编辑</Button>
      <Button size="sm" variant={mobileStep === 'result' ? 'secondary' : 'ghost'} aria-pressed={mobileStep === 'result'} aria-controls="image-text-result" onClick={() => setMobileStep('result')}>图片预览{busy && <LoaderCircle className="animate-spin" />}</Button>
    </div>
    <div className={creationGrid}>
        <section id="image-text-plan" aria-label="图文策划与确认" className={cn('surface min-h-0 flex-col overflow-hidden',mobileStep === 'plan' ? 'flex' : 'hidden lg:flex')}>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <h2 className="section-title shrink-0">{draft && !draft.confirmed ? '核对并确认' : '稿件与素材'}</h2>
            <div className="flex min-w-0 items-center gap-1"><span className="muted-copy truncate">{draft ? (draft.source.sourceHotspot ? '热点话题策划' : draft.typeOrigin === 'manual' ? '人工指定' : '自动识别') + ' · ' + draft.pages.length + ' 张' : '粘贴链接后显示'}</span>
              {draft && !draft.confirmed && <Button size="sm" variant="ghost" className="px-2" disabled={busy || uploading} title="按当前行业、公司业务和知识库重新策划" onClick={() => { void state.plan(); }}>重新策划草案</Button>}
            </div>
          </div>
          {draft ? <Tabs.Root value={activeTab} onValueChange={value => { if (tabs.some(item => item === value)) { setTab(value as ImageTextTab); if (planScroll.current) planScroll.current.scrollTop = 0; } }} className="flex min-h-0 flex-1 flex-col">
            <Tabs.List aria-label="图文编辑分页" className="tab-list shrink-0 border-b px-2 py-2">
              {tabs.map(value => <Tabs.Tab key={value} value={value} className="tab">{value === 'copy' ? '文案' : value === 'pages' ? activeTab === 'pages' ? '逐图' : '逐图 · 第 ' + (draft.pages.findIndex(p => p.id === page?.id) + 1) + ' 图' : value === 'style' ? '风格' : value === 'assets' ? '素材 ' + draft.references.length : '发布文案'}</Tabs.Tab>)}
            </Tabs.List>
            <div ref={planScroll} className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="image-text-plan-scroll">
              {!draft.confirmed && <>
                <Tabs.Panel value="copy" keepMounted className="space-y-4">
                  <TextField label="发布标题" value={draft.title} disabled={busy || uploading} onChange={title => state.updateDraft({ title })} rows={2} />
                  <TextField label="配套发布正文" value={draft.body} disabled={busy || uploading} onChange={body => state.updateDraft({ body })} rows={5} />
                  <TagsField tags={draft.tags} disabled={busy || uploading} onChange={tags => state.updateDraft({ tags })} />
                </Tabs.Panel>
                <Tabs.Panel value="pages" keepMounted className="space-y-4">
                  {page && <>
                    <div className="flex items-center gap-1 overflow-x-auto">
                      <p className="section-title mr-auto shrink-0 whitespace-nowrap text-xs">当前第 {draft.pages.findIndex(p => p.id === page.id) + 1} 图内容</p>
                      <Menu.Root><Menu.Trigger render={<Button size="sm" className="gap-1 px-2" disabled={busy || uploading || draft.pages.length >= 30} />}><Plus />增加一图</Menu.Trigger>
                        <Menu.Portal><Menu.Positioner sideOffset={4} className="z-50"><Menu.Popup className="min-w-32 rounded-md border bg-popover p-1 shadow-md">
                          <Menu.Item className="cursor-pointer rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-muted" onClick={() => state.addPage('before')}>往前增加</Menu.Item>
                          <Menu.Item className="cursor-pointer rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-muted" onClick={() => state.addPage('after')}>往后增加</Menu.Item>
                        </Menu.Popup></Menu.Positioner></Menu.Portal>
                      </Menu.Root>
                      <Button size="sm" variant="danger" className="gap-1 px-2" disabled={busy || uploading || draft.pages.length <= 1} onClick={() => state.removePage(page.id)}><X />删除当前图</Button>
                    </div>
                    <TextField label="图片内文字" value={page.text} disabled={busy || uploading} onChange={text => state.updatePage(page.id, { text })} />
                    <TextField label="画面要求" value={page.visual} disabled={busy || uploading} onChange={visual => state.updatePage(page.id, { visual })} />
                  </>}

                </Tabs.Panel>
                <Tabs.Panel value="style" keepMounted className="space-y-4"><ImageTextStyleCardEditor draft={draft} disabled={busy || uploading} onChange={styleCard => state.updateDraft({ styleCard })} /></Tabs.Panel>
              </>}
              {draft.confirmed && <Tabs.Panel value="publish" keepMounted className="space-y-4">
                <TextField label="发布标题" testId="image-text-title" value={draft.title} disabled={busy || uploading} onChange={title => state.updateDraft({ title })} rows={2} />
                <TextField label="配套发布正文" value={draft.body} disabled={busy || uploading} onChange={body => state.updateDraft({ body })} rows={8} />
                <TagsField tags={draft.tags} disabled={busy || uploading} onChange={tags => state.updateDraft({ tags })} />
                <Button size="sm" disabled={busy || uploading || !draft.body} onClick={() => { void navigator.clipboard.writeText(publicationText(draft)).then(() => notifySuccess('发布文案已复制')).catch(report); }}>复制文案</Button>
              </Tabs.Panel>}
              <Tabs.Panel value="assets" keepMounted className="space-y-4">
                {imageProtocol === 'glm' && <p className="muted-copy">当前 GLM-Image 接入仅支持文字生图，参考图上传已关闭。使用参考图请切换 Agnes／Seedream；继续使用 GLM 前请移除风格图或取消本页绑定。</p>}
                {!draft.confirmed && <><div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || uploading || !supportsImageReferences} onClick={() => { void addReferences('style'); }}>补传原帖参考图</Button><Button size="sm" disabled={busy || uploading || !supportsImageReferences} onClick={() => { void addReferences('scene'); }}>上传实际场景参考图（可选）</Button></div><p className="muted-copy">原帖图跟随风格与比例；实景图保留关键外观，首轮供整套参考，生成后可按页绑定。</p></>}
                <ImageTextReferences references={draft.references} disabled={busy || uploading} onRemove={id => { void removeReference(id); }} />
                {draft.confirmed && !draft.references.length && <p className="muted-copy">{imageProtocol === 'glm' ? '当前 GLM 根据文字要求重新生成图片；使用参考图请切换 Agnes／Seedream。' : '当前没有参考素材，可在图片优化中按页补传实际场景图。'}</p>}
                <details className="disclosure"><summary>原帖素材</summary><div className="mt-3 space-y-3"><p className="reading-text">{draft.source.publishedText || draft.source.transcript}</p><ExtractedContentDetails content={draft.source} /></div></details>
              </Tabs.Panel>
              <div className="mt-4 rounded-md border border-primary/15 border-l-[3px] border-l-primary bg-accent/50 p-3 text-xs" data-testid="image-text-industry-context">
                <p className="font-medium">目标行业：{draft.remixContext?.industryProfile?.primaryIndustry || draft.source.sourceHotspot?.industryProfile?.primaryIndustry || (draft.remixContext ? '依据公司业务与知识库' : '尚未绑定，请重新策划')}</p>
                {!!(draft.remixContext?.industryProfile?.subCategories || draft.source.sourceHotspot?.industryProfile?.subCategories)?.length && <p className="mt-1 break-words text-muted-foreground">行业标签：{(draft.remixContext?.industryProfile?.subCategories || draft.source.sourceHotspot?.industryProfile?.subCategories)?.join('、')}</p>}
                <p className="mt-1 text-muted-foreground">先分析素材与行业的关联，再生成文案和分页。重新策划应用当前行业，优化沿用本稿行业。</p>
              </div>
              {!!draft.notices.length && <details key={draft.id} className="disclosure mt-4 bg-muted/40 p-3" data-testid="image-text-plan-notices">
                <summary className="cursor-pointer font-medium">策划说明与核对事项</summary>
                <ul className="mt-2 list-disc space-y-2 pl-4 text-muted-foreground">{draft.notices.map((notice, index) => <li key={index} className="whitespace-pre-wrap break-words">{notice}</li>)}</ul>
              </details>}

            </div>
            {!draft.confirmed && <footer className="shrink-0 space-y-2 border-t border-primary/15 bg-accent/30 px-3 py-2 pb-[max(.5rem,env(safe-area-inset-bottom))]">
              <div className="flex flex-wrap items-center gap-3"><p className="text-xs">共 {draft.pages.length} 张</p><label className="flex items-center gap-2 text-xs">整套图片比例<select className="field w-auto" title={draft.ratioOrigin} aria-describedby="image-text-ratio-help" value={draft.ratio} disabled={busy || uploading} onChange={e => state.updateDraft({ ratio: e.target.value as ImageTextDraft['ratio'], ratioOrigin: '用户在本次确认环节选择整套比例' })}>{IMAGE_RATIOS.map(r => <option key={r}>{r}</option>)}</select></label></div>
              <span id="image-text-ratio-help" className="sr-only">{draft.ratioOrigin}</span><span id="image-text-confirm-help" className="sr-only">此处确认前不会调用生图接口；确认后无需逐页确认。</span>
              <Button variant="primary" className="w-full whitespace-normal text-center" title="此处确认前不会调用生图接口；确认后无需逐页确认。" aria-describedby="image-text-confirm-help" disabled={busy || uploading || !draft.pages.length} onClick={() => { void state.confirmAndGenerate(); }}>确认文案、张数及比例，开始生成 {draft.pages.length} 张图片</Button>
            </footer>}
          </Tabs.Root> : <>
            <div role="tablist" aria-label="图文编辑分页" className="tab-list shrink-0 border-b px-2 py-2">{planTabs.map((value, index) => <button key={value} role="tab" aria-selected="false" disabled className="tab opacity-45">{['文案','逐图','风格','素材'][index]}</button>)}</div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4" data-testid="image-text-plan-scroll"><div className="max-w-sm py-8 text-center">
              <span className="empty-state-icon"><NotebookPen className="h-7 w-7" aria-hidden="true" strokeWidth={1.6} /></span>
              <p className="text-base font-semibold tracking-tight">从一篇好素材开始</p>
              <p className="mt-2 muted-copy">提取后，原帖标题、正文和图片文字显示在这里，核对并确认后开始生成。</p>
              <ol className="mt-5 flex flex-wrap justify-center gap-2" aria-label="图文策划流程">{['提取原帖', '关联行业', '核对策划'].map((step, index) => <li key={step} className="workflow-step"><span className="font-semibold tabular-nums text-primary">{index + 1}</span>{step}</li>)}</ol>
            </div></div>
          </>}
        </section>
        <section id="image-text-result" aria-label="图文结果" className={cn('surface min-h-0 flex-col overflow-hidden',mobileStep === 'result' ? 'flex' : 'hidden lg:flex')}>{draft ? <ImageTextResult draft={draft} activePageId={activePageId} onSelect={state.selectPage} busy={busy || uploading} onVersion={(pageId,versionId) => { void state.changeVersion(pageId,versionId).catch(report); }} onReview={(pageId,checked) => { void state.markReviewed(pageId,checked).catch(report); }} onOptimize={draft.confirmed ? startOptimize : undefined} /> : <>
          <div className="shrink-0 border-b px-4 py-2"><h2 className="section-title">图片预览</h2></div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4"><div className="w-full max-w-sm rounded-xl border border-dashed border-primary/20 bg-accent/30 px-5 py-10 text-center" data-testid="image-text-empty">
              <span className="empty-state-icon"><Images className="h-7 w-7" aria-hidden="true" strokeWidth={1.6} /></span>
              <p className="text-base font-semibold tracking-tight">图片将在这里呈现</p>
              <p className="mt-2 muted-copy">先提取链接，核对文案、张数与比例，确认后生成整套图片。</p>
              <ol className="mt-5 flex flex-wrap justify-center gap-2" aria-label="图片生成流程">{['确认草案', '生成图片', '核对导出'].map((step, index) => <li key={step} className="workflow-step"><span className="font-semibold tabular-nums text-primary">{index + 1}</span>{step}</li>)}</ol>
            </div></div>
        </>}</section>
    </div>
    <Modal open={!!optimization} onOpenChange={open => { if (!open) setOptimization(null); }} busy={uploading || busy} title={optimizedPage ? '图片优化' : '全局优化'}
      description={optimizedPage ? (imageProtocol === 'glm' ? '根据本页文字和画面要求重新生成当前图片。' : '仅更新当前指定图片，其他页面保持不变。可补传真实场景图，保留关键外观。') : '优化整套图文，仅重生成受影响页面。仅修改发布文案不会触发生图。整套风格或比例改变将影响全部页面。'}
      footer={<><Button variant="ghost" onClick={() => { if (busy) void state.cancel(); setOptimization(null); }} disabled={uploading}>取消</Button><Button variant="primary" disabled={busy || uploading} onClick={() => { void submitOptimization(); }}>{optimizedPage ? '优化并重生成本图' : instruction.trim() && !previewReady ? '生成优化预览' : impact.length ? '应用全局优化' : '仅更新文案'}</Button></>}>
      {optimization && <fieldset disabled={busy || uploading} className="space-y-4">
        {localError && <p role="alert" className="text-sm text-destructive">{localError}</p>}
        {!optimizedPage && <div className="rounded-md border p-3 text-xs" aria-label="优化影响预览"><p>{impact.length ? '预计生成 ' + impact.length + ' 张图片' : '仅更新文案，不触发生图'}</p>{impact.map(item => <p key={item.pageId}>第 {item.number} 图：{item.reasons.join('、')}</p>)}</div>}
        {imageProtocol === 'glm' && <p className="muted-copy">当前 GLM-Image 接入仅支持文字生图，参考图上传和上一版图片参考已关闭；已有绑定请先取消，或切换 Agnes／Seedream。</p>}
        {optimizedPage ? <>
          <TextField label="本图文字" value={optimizedPage.text} onChange={text => patchOptimizedPage({ text })} />
          <TextField label="画面要求／优化要求" value={optimizedPage.visual} onChange={visual => patchOptimizedPage({ visual })} rows={5} />
          <Button size="sm" disabled={uploading || !supportsImageReferences} onClick={() => { void uploadOptimizationReference(); }}>为本图补传实际场景图（可选）</Button>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={previousDefault} disabled={!originalPage?.assetId || !supportsImageReferences} onChange={e => setUsePrevious(e.target.checked)} />附带本页上一版图片作参考（{imageProtocol === 'glm' ? '当前 GLM 接入不支持' : '仅改文字默认开启，改画面默认关闭'}）</label>
          {referenceOptions(optimization.draft.references, optimizedPage.referenceIds, referenceIds => patchOptimizedPage({ referenceIds }))}
          <ImageTextReferences references={optimization.draft.references} disabled={busy || uploading} onRemove={id => { void removeReference(id); }} />
        </> : <>
          <TextField label="发布标题" value={optimization.draft.title} onChange={title => patchOptimization({ title })} />
          <TextField label="配套发布正文" value={optimization.draft.body} onChange={body => patchOptimization({ body })} rows={5} />
          <TagsField tags={optimization.draft.tags} onChange={tags => patchOptimization({ tags })} />
          <ImageTextStyleCardEditor draft={optimization.draft} onChange={styleCard => patchOptimization({ styleCard })} />
          <label className="block text-xs">整套比例<select className="field mt-1.5" value={optimization.draft.ratio} onChange={e => patchOptimization({ ratio: e.target.value as ImageTextDraft['ratio'], ratioOrigin: '用户在全局优化中调整' })}>{IMAGE_RATIOS.map(r => <option key={r}>{r}</option>)}</select></label>
          <details className="rounded-md border p-3"><summary className="cursor-pointer text-xs">逐页内容</summary><div className="mt-3 space-y-4">
            {optimization.draft.pages.map((p,i) => <div key={p.id} className="space-y-2 border-b pb-3"><p className="text-xs font-medium">第 {i+1} 图</p>
              <TextField label="图内文字" value={p.text} onChange={text => patchOptimization({pages:optimization.draft.pages.map(item => item.id === p.id ? {...item,text}:item)})} />
              <TextField label="画面要求" value={p.visual} onChange={visual => patchOptimization({pages:optimization.draft.pages.map(item => item.id === p.id ? {...item,visual}:item)})} />
            </div>)}
          </div></details>
          <TextField label="全局优化指令（可选，填写后调用文本模型重新策划）" value={instruction} onChange={value => { setInstruction(value); setPreviewReady(false); }} rows={4} />
        </>}
      </fieldset>}
    </Modal>
  </div>;
}
