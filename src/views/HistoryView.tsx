import { PLATFORM_LABELS, TRENDING_PLATFORMS, type TrendingPlatform } from '../../electron/services/trendingTypes';
import { useEffect, useRef, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Edit3,
  FolderOpen,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { exportScriptFileClient, openSQLiteDatabaseFolder } from '../services/ipcClient';
import { formatDateTime, historyGrid, cn } from '../lib/utils';
import { ScriptResult } from '../components/message/ScriptResult';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { notifyError, notifySuccess } from '../components/ui/Toast';
import { useImageTextStore } from '../store/useImageTextStore';
import { ImageTextResult } from '../components/imageText/ImageTextResult';
import { publicationText } from '../../electron/services/imageTextModel';
import type { ImageTextDraft } from '../../electron/services/imageTextTypes';
import type { HistoryRecord } from '../types';
import { getScriptOutputText, type OutputTab } from '../lib/scriptOutput';

interface HistoryListItem {
  id: string;
  title: string;
  createdAt: string;
  platform: TrendingPlatform;
  kind: 'video' | 'image-text';
  video?: HistoryRecord;
  image?: ImageTextDraft;
}
export function HistoryView() {
  const {
    historyRecords,
    isLoadingHistory,
    selectedHistoryId,
    setSelectedHistoryId,
    deleteHistoryRecord,
    loadHistoryToWorkbench,
    loadHistoryFromSQLite,
    dbStatusInfo,
    historyFilterPlatform,
    setHistoryFilterPlatform,
    historySearchQuery,
    setHistorySearchQuery,
  } = useAppStore();
  const imageState = useImageTextStore();
  const [pendingImage, setPendingImage] = useState<ImageTextDraft | null>(null);
  const [openingImage, setOpeningImage] = useState(false);
  const [imageOpenError, setImageOpenError] = useState('');
  const openImage = (draft: ImageTextDraft) => {
    try {
      if (useImageTextStore.getState().hasUnsavedChanges()) { setPendingImage(structuredClone(draft)); setImageOpenError(''); return; }
      useImageTextStore.getState().loadDraft(draft); useAppStore.getState().setActiveNav('image-text');
    } catch (error) { notifyError(error instanceof Error ? error.message : '读取图文失败。'); }
  };
  const resolveImageOpen = async (save: boolean) => {
    if (!pendingImage || openingImage) return;
    setOpeningImage(true); setImageOpenError('');
    try {
      const current = useImageTextStore.getState().draft;
      if (save) await useImageTextStore.getState().save();
      const target = save && current?.id === pendingImage.id ? current : pendingImage;
      useImageTextStore.getState().loadDraft(target,true);
      setPendingImage(null); useAppStore.getState().setActiveNav('image-text');
    } catch (error) { setImageOpenError(error instanceof Error ? error.message : '打开图文失败，当前修改已保留。'); }
    finally { setOpeningImage(false); }
  };
  const [contentFilter, setContentFilter] = useState<'all' | 'video' | 'image-text'>('all');
  const [imagePageId, setImagePageId] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(true);
  const selectLatest = useRef(true);
  const refreshImages = async () => {
    setImageLoading(true);
    try { await useImageTextStore.getState().loadRecords(); }
    catch (error) { notifyError(error instanceof Error ? error.message : '读取图文历史失败。'); }
    finally { setImageLoading(false); }
  };
  useEffect(() => { void refreshImages(); }, []);
  const [notice, setNotice] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [outputTab, setOutputTab] = useState<OutputTab>('storyboard');
  const [deleteTarget, setDeleteTarget] = useState<HistoryListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteInfo,setDeleteInfo] = useState<{count:number;bytes:number} | null>(null);
  const [deleteInfoLoading,setDeleteInfoLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const deleting = useRef(false);
  const closeDelete = () => {
    if (deleting.current) return;
    setDeleteTarget(null);
    setDeleteError('');
  };
  const confirmDelete = async () => {
    if (!deleteTarget || deleting.current || deleteInfoLoading || (deleteTarget.kind === 'image-text' && !deleteInfo)) return;
    deleting.current = true;
    setIsDeleting(true);
    setDeleteError('');
    try {
      if (deleteTarget.kind === 'image-text') await imageState.deleteRecord(deleteTarget.id);
      else await deleteHistoryRecord(deleteTarget.id);
      setDeleteTarget(null);
      notifySuccess('历史记录已删除');
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除历史记录失败，请重试。';
      setDeleteError(message);
      notifyError(message, '历史记录未删除');
    } finally {
      deleting.current = false;
      setIsDeleting(false);
    }
  };
  const displayRecords: HistoryListItem[] = [
    ...historyRecords.map((video): HistoryListItem => ({ id: video.id, title: video.title, createdAt: video.createdAt, platform: video.platform, kind: 'video' as const, video })),
    ...imageState.records.map((image): HistoryListItem => ({ id: image.id, title: image.title, createdAt: image.createdAt, platform: image.source.platform, kind: 'image-text' as const, image })),
  ].filter(record => (contentFilter === 'all' || record.kind === contentFilter) &&
    (historyFilterPlatform === 'all' || record.platform === historyFilterPlatform) &&
    (!historySearchQuery.trim() || [record.title, record.image?.body || record.video?.rawGeneratedScript || '', record.image?.source.publishedText || record.video?.originalTranscript || '', record.image?.pages.map(page => page.text + ' ' + page.visual).join(' ') || ''].join(' ').toLocaleLowerCase().includes(historySearchQuery.trim().toLocaleLowerCase())))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestId = displayRecords[0]?.id || null;
  const selectedIsVisible = displayRecords.some(record => record.id === selectedHistoryId);
  useEffect(() => {
    if (isLoadingHistory || imageLoading) return;
    if (selectLatest.current || !selectedIsVisible) {
      selectLatest.current = false;
      setSelectedHistoryId(latestId);
      setImagePageId(null);
      setShowDetail(!!latestId);
    }
  }, [isLoadingHistory, imageLoading, selectedIsVisible, latestId, setSelectedHistoryId]);
  const selectedEntry = displayRecords.find(record => record.id === selectedHistoryId) || displayRecords[0] || null;
  const selectedRecord = selectedEntry?.video || null;
  const selectedImage = selectedEntry?.image || null;
  const handleExport = async (format: 'txt' | 'doc') => {
    if (!selectedRecord) return;
    try {
      const filename = selectedRecord.title.slice(0, 20) + '_二创分镜脚本.' + format;
      if (await exportScriptFileClient(filename, selectedRecord.rawGeneratedScript, format))
        setNotice('已导出：' + filename);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导出失败，请重试。');
    }
  };
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      setNotice('复制失败，请选择文字后手动复制。');
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-4 md:px-6">
        <h1 className="text-sm font-semibold">历史记录</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={isLoadingHistory || imageLoading}
            onClick={() => {
              void loadHistoryFromSQLite();
              void refreshImages();
            }}
          >
            <RefreshCw className={cn(isLoadingHistory && 'animate-spin')} />
            刷新
          </Button>
          <details className="relative text-xs text-muted-foreground">
            <summary className="cursor-pointer p-2">存储信息</summary>
            <div className="absolute right-0 top-full z-10 mt-2 w-64 space-y-3 rounded-md border bg-popover p-4 shadow-sm">
              <p>{dbStatusInfo ? `本设备已保存 ${dbStatusInfo.totalCount} 条记录。` : '记录总数暂不可用，请刷新重试。'}</p>
              {dbStatusInfo?.engine !== 'browser-local' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void openSQLiteDatabaseFolder().catch(() => setNotice('打开存储目录失败'));
                  }}
                >
                  <FolderOpen />
                  打开存储目录
                </Button>
              )}
            </div>
          </details>
        </div>
      </header>
      {notice && (
        <p role="status" className="status-note mx-4 mt-3">
          {notice}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setNotice('')}>
            关闭
          </Button>
        </p>
      )}
      <div className={historyGrid}>
        <section
          aria-label="历史列表"
          className={cn(
            'surface min-h-0 flex-col overflow-hidden',
            showDetail ? 'hidden lg:flex' : 'flex'
          )}
        >
          <div className="space-y-3 border-b p-4">
            <div className="flex gap-1" aria-label="内容类型筛选">
              {(['all', 'video', 'image-text'] as const).map(value => <Button key={value} size="sm" variant={contentFilter === value ? 'secondary' : 'ghost'}
                aria-pressed={contentFilter === value} onClick={() => setContentFilter(value)}>{value === 'all' ? '全部内容' : value === 'video' ? '视频' : '图文'}</Button>)}
            </div>
            <div className="flex flex-wrap gap-1" aria-label="平台筛选">
              {(['all', ...TRENDING_PLATFORMS] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={historyFilterPlatform === value ? 'secondary' : 'ghost'}
                  aria-pressed={historyFilterPlatform === value}
                  onClick={() => setHistoryFilterPlatform(value)}
                >
                  {value === 'all' ? '全部' : PLATFORM_LABELS[value]}
                </Button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <label className="sr-only" htmlFor="history-search">
                搜索历史记录
              </label>
              <input
                id="history-search"
                value={historySearchQuery}
                onChange={(event) => setHistorySearchQuery(event.target.value)}
                placeholder="搜索标题或脚本"
                className="field pl-9"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {displayRecords.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                {isLoadingHistory || imageLoading ? '正在读取记录…' : '没有找到历史记录'}
              </p>
            ) : (
              displayRecords.map((record) => (
                <div
                  key={record.id}
                  className={cn(
                    'group relative rounded-md border transition-[border-color,background-color,box-shadow] duration-150',
                    selectedEntry?.id === record.id ? 'border-primary/30 bg-accent shadow-[inset_3px_0_0_hsl(var(--primary))]' : 'border-transparent hover:border-primary/20 hover:bg-muted hover:shadow-sm'
                  )}
                >
                  <button
                    type="button"
                    data-testid="history-record"
                    data-record-id={record.id}
                    onClick={() => {
                      selectLatest.current = false;
                      setSelectedHistoryId(record.id);
                      setShowDetail(true);
                    }}
                    aria-pressed={selectedEntry?.id === record.id}
                    className="block w-full min-w-0 rounded-md p-3 pr-11 text-left"
                  >
                    <p className={cn('truncate text-sm', selectedEntry?.id === record.id ? 'font-semibold text-accent-foreground' : 'font-medium')}>{record.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {record.video?.parsedStructure?.voiceoverFullText || record.video?.rawGeneratedScript || record.image?.body}
                    </p>
                    <p className="mt-3 text-[11px] tabular-nums text-muted-foreground">
                      <span className="mr-1 inline-flex rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">{PLATFORM_LABELS[record.platform]}{(record.video?.sourceContent?.sourceHotspot || record.image?.source.sourceHotspot) ? '热点' : ''}</span> ·{' '}
                      {formatDateTime(record.createdAt)} · {record.image ? record.image.pages.length + ' 张图文' : (record.video?.durationSec || 0) + ' 秒视频'}
                    </p>
                  </button>
                  <Button
                    size="icon"
                    variant="danger"
                    className="absolute right-0 top-1"
                    aria-label={'删除记录 ' + record.title}
                    onClick={() => {
                      setDeleteError(''); setDeleteInfo(null); setDeleteTarget(record);
                      if (record.kind === 'image-text') {
                        setDeleteInfoLoading(true);
                        void window.electronAPI?.getImageTextDeletionInfo(record.id).then(result => {
                          if (!result.success || !result.data) throw new Error(result.error || '读取图片占用失败。'); setDeleteInfo(result.data);
                        }).catch(error => setDeleteError(error instanceof Error ? error.message : '读取图片占用失败。')).finally(() => setDeleteInfoLoading(false));
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))
            )}
          </div>
        </section>
        <section
          aria-label="历史详情"
          className={cn(
            'surface min-h-0 flex-col overflow-hidden',
            showDetail ? 'flex' : 'hidden lg:flex'
          )}
        >
          {selectedImage ? <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
              <Button size="sm" variant="ghost" aria-label="返回列表" className="-ml-2 lg:hidden" onClick={() => setShowDetail(false)}><ArrowLeft /></Button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold" title={selectedImage.title}>{selectedImage.title}</h2>
                <p className="muted-copy">{formatDateTime(selectedImage.createdAt)} · {PLATFORM_LABELS[selectedImage.source.platform]}{selectedImage.source.sourceHotspot ? '热点' : ''} · {selectedImage.pages.length} 张</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" onClick={() => openImage(selectedImage)}><Edit3 />重新编辑</Button>
                <Button size="sm" variant="ghost" onClick={() => { void copy(publicationText(selectedImage), selectedImage.id); }}><Copy />复制发布文案</Button>
                <Button size="sm" variant="ghost" onClick={async () => { try {
                  const result = await window.electronAPI?.exportImageText(selectedImage,useAppStore.getState().keywords.filter(k => k.category === 'forbidden').map(k => k.text)); if (result?.canceled) return;
                  if (!result?.success) throw new Error(result?.error || '导出失败。'); setNotice('素材包已导出到 ' + result.data);
                } catch (error) { setNotice(error instanceof Error ? error.message : '导出失败。'); } }}><Download />导出素材包</Button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col"><ImageTextResult draft={selectedImage} activePageId={imagePageId} onSelect={setImagePageId} showPublication /></div>
          </> : selectedRecord ? (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
                <Button size="sm" variant="ghost" aria-label="返回列表" className="-ml-2 lg:hidden" onClick={() => setShowDetail(false)}><ArrowLeft /></Button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold" title={selectedRecord.title}>{selectedRecord.title}</h2>
                  <p className="muted-copy">{formatDateTime(selectedRecord.createdAt)} · {PLATFORM_LABELS[selectedRecord.platform]}{selectedRecord.sourceContent?.sourceHotspot ? '热点' : ''}{selectedRecord.durationSec > 0 && ' · ' + selectedRecord.durationSec + ' 秒'}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" onClick={() => loadHistoryToWorkbench(selectedRecord)}><Edit3 />重新编辑</Button>
                  <Button size="sm" variant="ghost" aria-label="复制当前标签内容" onClick={() => {
                    void copy(getScriptOutputText(outputTab, selectedRecord.parsedStructure, selectedRecord.rawGeneratedScript, selectedRecord.userCameraWork, selectedRecord), selectedRecord.id + outputTab);
                  }}>{copiedKey === selectedRecord.id + outputTab ? <Check /> : <Copy />}{copiedKey === selectedRecord.id + outputTab ? '已复制' : '复制'}</Button>
                  <Menu.Root>
                    <Menu.Trigger render={<Button size="sm" variant="ghost" />}><Download />导出</Menu.Trigger>
                    <Menu.Portal><Menu.Positioner sideOffset={4} align="end" className="z-50">
                      <Menu.Popup className="min-w-32 rounded-md border bg-popover p-1 shadow-md">
                        <Menu.Item className="cursor-pointer rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-muted" onClick={() => { void handleExport('txt'); }}>导出文本</Menu.Item>
                        <Menu.Item className="cursor-pointer rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-muted" onClick={() => { void handleExport('doc'); }}>导出文档</Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner></Menu.Portal>
                  </Menu.Root>
                </div>
              </div>
              <ScriptResult
                key={selectedRecord.id}
                script={selectedRecord.parsedStructure}
                text={selectedRecord.rawGeneratedScript}
                busy={false}
                targetDuration={selectedRecord.durationSec}
                cameraWork={selectedRecord.userCameraWork}
                checks={[]}
                onCopy={copy}
                copiedKey={copiedKey}
                source={selectedRecord}
                activeTab={outputTab}
                onTabChange={setOutputTab}
                hideToolbar
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              选择一条记录查看内容
            </div>
          )}
        </section>
      </div>
      <Modal open={!!pendingImage} onOpenChange={open => { if (!open) setPendingImage(null); }} busy={openingImage}
        title="当前图文有未保存修改" description="打开历史将替换当前稿件。可先保存、明确放弃修改，或取消返回。"
        footer={<><Button disabled={openingImage} onClick={() => setPendingImage(null)}>取消</Button><Button disabled={openingImage} onClick={() => { void resolveImageOpen(false); }}>放弃修改并打开</Button><Button variant="primary" disabled={openingImage} onClick={() => { void resolveImageOpen(true); }}>保存修改并打开</Button></>}>
        <p className="text-sm">{imageState.draft?.title}</p>{imageOpenError && <p role="alert" className="text-sm text-destructive">{imageOpenError}</p>}
      </Modal>
      <Modal
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) closeDelete(); }}
        title="删除历史记录"
        description="确认删除这条历史记录？此操作不可撤销。"
        centered
        busy={isDeleting}
        initialFocus={cancelDelete}
        footer={
          <>
            <Button ref={cancelDelete} variant="ghost" disabled={isDeleting} onClick={closeDelete}>
              取消
            </Button>
            <Button variant="danger" disabled={isDeleting || deleteInfoLoading || (deleteTarget?.kind === 'image-text' && !deleteInfo)} onClick={() => { void confirmDelete(); }}>
              {isDeleting ? '正在删除…' : '确认删除'}
            </Button>
          </>
        }
      >
        <div aria-busy={isDeleting} className="space-y-3">
          <p className="break-words text-sm font-medium">{deleteTarget?.title}</p>
          {deleteTarget?.kind === 'image-text' && <p className="text-sm text-muted-foreground">{deleteInfoLoading ? '正在统计全部页面版本与图片占用…' : deleteInfo ? '将删除全部页面版本及 ' + deleteInfo.count + ' 个图片文件，共 ' + (deleteInfo.bytes/1024/1024).toFixed(2) + ' MB。' : '图片数量读取失败，请关闭后重试。'}</p>}
          <p className="text-sm leading-relaxed text-muted-foreground">
            将从本机历史记录中永久删除该记录及其保存的脚本、原稿和版本记录。其他历史记录和已导出的文件不受影响。
          </p>
          {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
        </div>
      </Modal>
    </div>
  );
}
