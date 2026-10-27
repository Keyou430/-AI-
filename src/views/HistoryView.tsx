import { useState } from 'react';
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
import { formatDateTime, cn } from '../lib/utils';
import { ScriptResult } from '../components/message/ScriptResult';
import { Button } from '../components/ui/Button';
import { getScriptOutputText, type OutputTab } from '../lib/scriptOutput';

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
  const [notice, setNotice] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [outputTab, setOutputTab] = useState<OutputTab>('storyboard');
  const selectedRecord =
    historyRecords.find((record) => record.id === selectedHistoryId) || historyRecords[0] || null;
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
            disabled={isLoadingHistory}
            onClick={() => {
              void loadHistoryFromSQLite();
            }}
          >
            <RefreshCw className={cn(isLoadingHistory && 'animate-spin')} />
            刷新
          </Button>
          <details className="relative text-xs text-muted-foreground">
            <summary className="cursor-pointer p-2">存储信息</summary>
            <div className="absolute right-0 top-full z-10 mt-2 w-64 space-y-3 rounded-md border bg-popover p-4 shadow-sm">
              <p>本设备已保存 {dbStatusInfo?.totalCount ?? historyRecords.length} 条记录。</p>
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
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-3 md:p-5 lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)] lg:gap-5">
        <section
          aria-label="历史列表"
          className={cn(
            'surface min-h-0 flex-col overflow-hidden',
            showDetail ? 'hidden lg:flex' : 'flex'
          )}
        >
          <div className="space-y-3 border-b p-4">
            <div className="flex gap-1" aria-label="平台筛选">
              {(['all', 'douyin', 'xiaohongshu'] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={historyFilterPlatform === value ? 'secondary' : 'ghost'}
                  aria-pressed={historyFilterPlatform === value}
                  onClick={() => setHistoryFilterPlatform(value)}
                >
                  {value === 'all' ? '全部' : value === 'douyin' ? '抖音' : '小红书'}
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
            {historyRecords.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                {isLoadingHistory ? '正在读取记录…' : '没有找到历史记录'}
              </p>
            ) : (
              historyRecords.map((record) => (
                <div
                  key={record.id}
                  className={cn(
                    'group relative rounded-md',
                    selectedRecord?.id === record.id ? 'bg-accent' : 'hover:bg-muted'
                  )}
                >
                  <button
                    type="button"
                    data-testid="history-record"
                    data-record-id={record.id}
                    onClick={() => {
                      setSelectedHistoryId(record.id);
                      setShowDetail(true);
                    }}
                    aria-pressed={selectedRecord?.id === record.id}
                    className="block w-full min-w-0 rounded-md p-3 pr-11 text-left"
                  >
                    <p className="truncate text-sm font-medium">{record.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {record.parsedStructure?.voiceoverFullText || record.rawGeneratedScript}
                    </p>
                    <p className="mt-3 text-[11px] tabular-nums text-muted-foreground">
                      {record.platform === 'douyin' ? '抖音' : '小红书'} ·{' '}
                      {formatDateTime(record.createdAt)} · {record.durationSec} 秒
                    </p>
                  </button>
                  <Button
                    size="icon"
                    variant="danger"
                    className="absolute right-0 top-1"
                    aria-label={'删除记录 ' + record.title}
                    onClick={() => {
                      void deleteHistoryRecord(record.id);
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
          {selectedRecord ? (
            <>
              <div className="shrink-0 space-y-3 border-b p-4">
                <Button
                  size="sm"
                  variant="ghost"
                  className="-ml-2 lg:hidden"
                  onClick={() => setShowDetail(false)}
                >
                  <ArrowLeft />
                  返回列表
                </Button>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold">{selectedRecord.title}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(selectedRecord.createdAt)}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => loadHistoryToWorkbench(selectedRecord)}>
                    <Edit3 />
                    重新编辑
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="复制当前标签内容"
                    onClick={() => {
                      void copy(
                        getScriptOutputText(
                          outputTab,
                          selectedRecord.parsedStructure,
                          selectedRecord.rawGeneratedScript,
                          selectedRecord.userCameraWork,
                          selectedRecord
                        ),
                        selectedRecord.id + outputTab
                      );
                    }}
                  >
                    {copiedKey === selectedRecord.id + outputTab ? <Check /> : <Copy />}
                    {copiedKey === selectedRecord.id + outputTab ? '已复制' : '复制'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void handleExport('txt');
                    }}
                  >
                    <Download />
                    导出文本
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void handleExport('doc');
                    }}
                  >
                    导出文档
                  </Button>
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
              选择一条记录查看脚本
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
