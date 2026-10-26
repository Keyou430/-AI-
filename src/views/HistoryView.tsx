import { ExtractedContentDetails } from '../components/ExtractedContentDetails';
import React, { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  History,
  Trash2,
  Edit3,
  Download,
  Clock,
  Search,
  FileText,
  Database,
  FolderOpen,
  Video,
  Camera,
  Mic,
  RefreshCw,
  Copy,
  Check,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  exportScriptFileClient,
  openSQLiteDatabaseFolder,
} from '../services/ipcClient';
import { formatDateTime, cn } from '../lib/utils';

export const HistoryView: React.FC = () => {
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

  const [detailTab, setDetailTab] = useState<
    'storyboard' | 'techniques' | 'voiceover' | 'raw'
  >('storyboard');
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const selectedRecord =
    historyRecords.find((r) => r.id === selectedHistoryId) ||
    historyRecords[0] ||
    null;

  const handleExport = async (format: 'txt' | 'doc') => {
    if (!selectedRecord) return;
    const ext = format === 'doc' ? 'doc' : 'txt';
    const filename = `${selectedRecord.title.slice(0, 20)}_二创分镜脚本.${ext}`;
    const ok = await exportScriptFileClient(
      filename,
      selectedRecord.rawGeneratedScript,
      format
    );
    if (ok) {
      setExportNotice(`已从 SQLite 导出为本地文件：${filename}`);
      setTimeout(() => setExportNotice(null), 2800);
    }
  };

  const handleCopyScript = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
      {/* 顶部 SQLite 本地数据库状态栏 */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">
                SQLite 本地数据库已连接
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium border border-emerald-200">
                引擎：{dbStatusInfo?.engine || 'sqlite3'}
              </span>
              <span className="text-[11px] text-slate-500">
                已持久化 {dbStatusInfo?.totalCount ?? historyRecords.length} 条记录
                {dbStatusInfo?.dbSizeBytes
                  ? ` (${(dbStatusInfo.dbSizeBytes / 1024).toFixed(1)} KB)`
                  : ''}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate max-w-2xl mt-0.5">
              数据库文件路径：{dbStatusInfo?.dbPath || '正在读取本地 SQLite 路径...'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadHistoryFromSQLite()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw
              className={cn('w-3.5 h-3.5', isLoadingHistory && 'animate-spin')}
            />
            刷新数据库
          </button>

          {dbStatusInfo?.engine !== 'browser-local' && (
            <button
              type="button"
              onClick={() => openSQLiteDatabaseFolder()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200/80 transition-colors"
              title="在 Windows 资源管理器中定位 .sqlite 数据库文件"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              定位 .sqlite 文件
            </button>
          )}
        </div>
      </header>

      {/* 主体双栏：左侧记录卡片列表 + 右侧分模块详情预览 */}
      <div className="flex-1 grid grid-cols-12 gap-5 p-6 overflow-hidden">
        {/* 左侧：记录列表 (4列) */}
        <section className="col-span-4 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-bold text-slate-900">
                  历史二创记录列表
                </h2>
              </div>
              <span className="text-xs text-slate-400">
                当前筛选 {historyRecords.length} 条
              </span>
            </div>

            {/* 平台筛选胶囊 */}
            <div className="grid grid-cols-3 gap-1.5 bg-slate-100 p-1 rounded-xl text-xs">
              {(
                [
                  { id: 'all', label: '全部平台' },
                  { id: 'douyin', label: '抖音' },
                  { id: 'xiaohongshu', label: '小红书' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setHistoryFilterPlatform(item.id)}
                  className={cn(
                    'py-1 rounded-lg font-medium transition-all',
                    historyFilterPlatform === item.id
                      ? 'bg-white text-indigo-700 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* SQL 关键词搜索框 */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={historySearchQuery}
                onChange={(e) => setHistorySearchQuery(e.target.value)}
                placeholder="SQL 检索标题、原片文案或分镜脚本..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* 记录卡片列表（按时间倒序） */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {historyRecords.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-400">
                SQLite 数据库中暂无匹配的历史二创记录
              </div>
            ) : (
              historyRecords.map((record) => {
                const isSelected = selectedRecord?.id === record.id;
                return (
                  <div
                    key={record.id}
                    onClick={() => setSelectedHistoryId(record.id)}
                    className={cn(
                      'p-3.5 rounded-xl border transition-all cursor-pointer group',
                      isSelected
                        ? 'bg-indigo-50/70 border-indigo-300 shadow-sm'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    )}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className={cn(
                          'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                          record.platform === 'douyin'
                            ? 'bg-slate-900 text-white'
                            : 'bg-rose-500 text-white'
                        )}
                      >
                        {record.platform === 'douyin' ? '抖音' : '小红书'}
                      </span>

                      <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {record.durationSec}秒
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteHistoryRecord(record.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition-opacity"
                          title="从 SQLite 数据库删除该记录"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-xs font-bold text-slate-900 line-clamp-1">
                      {record.title}
                    </div>
                    <div className="text-[11px] text-slate-500 line-clamp-2 mt-1">
                      {record.parsedStructure?.voiceoverFullText ||
                        record.rawGeneratedScript}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mt-2">
                      <span>生成时间：{formatDateTime(record.createdAt)}</span>
                      <span>
                        共 {record.parsedStructure?.shots?.length || 3} 个镜头
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 右侧：详情预览区 (8列) */}
        <section className="col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          {selectedRecord ? (
            <>
              {/* 顶部标题与操作按钮栏 */}
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-[11px] font-semibold px-2.5 py-0.5 rounded-full',
                        selectedRecord.platform === 'douyin'
                          ? 'bg-slate-900 text-white'
                          : 'bg-rose-500 text-white'
                      )}
                    >
                      {selectedRecord.platform === 'douyin' ? '抖音' : '小红书'}
                    </span>
                    <h2 className="text-base font-bold text-slate-900">
                      {selectedRecord.title}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    保存时间：{formatDateTime(selectedRecord.createdAt)} · 提取时长：
                    {selectedRecord.durationSec} 秒 · 运镜设定：
                    {selectedRecord.userCameraWork}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => loadHistoryToWorkbench(selectedRecord)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    重新编辑
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExport('txt')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    导出 TXT
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExport('doc')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    导出 Word
                  </button>
                </div>
              </div>

              {exportNotice && (
                <div className="mx-6 mt-3 px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs">
                  {exportNotice}
                </div>
              )}

              {/* 详情分模块 Tab 预览（完整展示拍摄脚本、拍摄手法、口播稿、原视频对比） */}
              <Tabs.Root
                value={detailTab}
                onValueChange={(v) => setDetailTab(v as any)}
                className="flex-1 flex flex-col overflow-hidden"
              >
                <div className="px-6 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
                  <Tabs.List className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                    <Tabs.Trigger
                      value="storyboard"
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                        detailTab === 'storyboard'
                          ? 'bg-white text-indigo-700 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      )}
                    >
                      <Video className="w-3.5 h-3.5" />
                      1. 拍摄脚本 ({selectedRecord.parsedStructure?.shots?.length || 0}镜头)
                    </Tabs.Trigger>

                    <Tabs.Trigger
                      value="techniques"
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                        detailTab === 'techniques'
                          ? 'bg-white text-indigo-700 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      )}
                    >
                      <Camera className="w-3.5 h-3.5" />
                      2. 拍摄手法
                    </Tabs.Trigger>

                    <Tabs.Trigger
                      value="voiceover"
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                        detailTab === 'voiceover'
                          ? 'bg-white text-indigo-700 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      )}
                    >
                      <Mic className="w-3.5 h-3.5" />
                      3. 口播稿 & 原片对照
                    </Tabs.Trigger>

                    <Tabs.Trigger
                      value="raw"
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                        detailTab === 'raw'
                          ? 'bg-white text-indigo-700 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      )}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      标准纯文本全文
                    </Tabs.Trigger>
                  </Tabs.List>

                  <button
                    type="button"
                    onClick={() =>
                      handleCopyScript(selectedRecord.rawGeneratedScript)
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        已复制
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        复制完整脚本
                      </>
                    )}
                  </button>
                </div>

                {/* Tab 1: 分镜拍摄脚本 */}
                <Tabs.Content
                  value="storyboard"
                  className="flex-1 overflow-y-auto p-6 space-y-3 focus:outline-none"
                >
                  {selectedRecord.parsedStructure?.shots?.map((shot) => (
                    <div
                      key={shot.shotNumber}
                      className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm"
                    >
                      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900">
                          【镜头{shot.shotNumber} | {shot.timeRange}】
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                          时长：{shot.durationSec}秒
                        </span>
                      </div>
                      <div className="p-4 space-y-2 text-xs leading-relaxed">
                        <div>
                          <strong className="text-slate-900">
                            ▪️人员动作分工：
                          </strong>
                          <span className="text-slate-700">
                            {shot.actionDivision}
                          </span>
                        </div>
                        <div>
                          <strong className="text-slate-900">
                            ▪️运镜与拍摄执行标准：
                          </strong>
                          <span className="text-slate-700">
                            {shot.cameraExecution}
                          </span>
                        </div>
                        <div>
                          <strong className="text-slate-900">
                            ▪️声音内容：
                          </strong>
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded font-medium',
                              shot.isAmbientOnly
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-indigo-50 text-indigo-950'
                            )}
                          >
                            {shot.audioContent}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </Tabs.Content>

                {/* Tab 2: 拍摄手法 */}
                <Tabs.Content
                  value="techniques"
                  className="flex-1 overflow-y-auto p-6 space-y-3 focus:outline-none"
                >
                  {selectedRecord.parsedStructure?.shootingTechniquesSummary?.map(
                    (item) => (
                      <div
                        key={item.shotNumber}
                        className="p-4 rounded-xl border border-slate-200 bg-white space-y-2"
                      >
                        <div className="text-xs font-bold text-slate-900">
                          镜头 {item.shotNumber}（{item.timeRange}）运镜与灯光标准
                        </div>
                        <p className="text-xs text-slate-700 leading-relaxed">
                          {item.cameraStandard}
                        </p>
                        <p className="text-xs text-slate-500 bg-slate-50 px-3 py-2 rounded-lg">
                          <strong>动线衔接建议：</strong>
                          {item.transitionAdvice}
                        </p>
                      </div>
                    )
                  )}
                </Tabs.Content>

                {/* Tab 3: 口播稿与原视频文案对照 */}
                <Tabs.Content
                  value="voiceover"
                  className="flex-1 overflow-y-auto p-6 space-y-4 focus:outline-none"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-100 space-y-2">
                      <h4 className="text-xs font-bold text-indigo-950">
                        二创润色后纯口播稿
                      </h4>
                      <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
                        {selectedRecord.parsedStructure?.voiceoverFullText}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                      <h4 className="text-xs font-bold text-slate-800">
                        本次二创输入（含人工修改）
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                        {selectedRecord.originalTranscript}
                      </p>
                    </div>
                    {selectedRecord.sourceContent && <>
                      <ExtractedContentDetails content={selectedRecord.sourceContent} />
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                        <h4 className="text-xs font-bold text-slate-800">原始提取口播（未修改）</h4>
                        <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{selectedRecord.sourceContent.transcript || '未获得有效口播'}</p>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                        <h4 className="text-xs font-bold text-slate-800">原始发布文案</h4>
                        <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{selectedRecord.sourceContent.publishedText || '未返回发布文案'}</p>
                      </div>
                    </>}
                  </div>
                </Tabs.Content>

                {/* Tab 4: 标准纯文本全文 */}
                <Tabs.Content
                  value="raw"
                  className="flex-1 overflow-y-auto p-6 focus:outline-none"
                >
                  <pre className="p-4 rounded-xl bg-slate-900 text-slate-100 text-xs leading-relaxed whitespace-pre-wrap font-sans">
                    {selectedRecord.rawGeneratedScript}
                  </pre>
                </Tabs.Content>
              </Tabs.Root>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs">
              请从左侧列表选择一条历史二创记录查看详情
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
