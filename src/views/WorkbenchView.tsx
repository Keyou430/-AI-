import React, { useState, useMemo } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  Link2,
  ClipboardPaste,
  Sparkles,
  Copy,
  Check,
  Wand2,
  AlertCircle,
  Video,
  Camera,
  Mic,
  FileText,
  CheckCircle2,
  ShieldCheck,
  Clock,
  RefreshCw,
  Download,
  RotateCcw,
  Edit3,
  Briefcase,
  BookOpen,
  History,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  parseVideoLinkClient,
  streamGenerateScriptClient,
} from '../services/ipcClient';
import { buildSystemPrompt, buildUserPrompt } from '../lib/promptBuilder';
import { parseGeneratedScript, runScriptComplianceChecks } from '../lib/scriptParser';
import type { HistoryRecord } from '../types';
import { ExtractedContentDetails } from '../components/ExtractedContentDetails';
import { OptimizeDialog } from '../components/OptimizeDialog';
import { cn, formatDateTime } from '../lib/utils';

export const WorkbenchView: React.FC = () => {
  const {
    linkInput,
    setLinkInput,
    targetDurationSec,
    setTargetDurationSec,
    userCameraWork,
    setUserCameraWork,
    isParsingVideo,
    setIsParsingVideo,
    parseError,
    setParseError,
    parsedVideo,
    setParsedVideo,
    editedTranscript,
    setEditedTranscript,
    editedVisualSummary,
    setEditedVisualSummary,
    resetEditedToOriginal,
    isGeneratingScript,
    setIsGeneratingScript,
    generateError,
    setGenerateError,
    streamingScriptText,
    appendStreamingChunk,
    parsedScript,
    refinementHistory,
    rollbackToVersion,
    saveGeneratedHistory,
    keywords,
    knowledgeDocs,
    settings,
    setActiveNav,
  } = useAppStore();

  const [activeOutputTab, setActiveOutputTab] = useState<
    'storyboard' | 'techniques' | 'voiceover' | 'raw'
  >('storyboard');
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [extractNotice, setExtractNotice] = useState<string | null>(null);

  const isManuallyEdited = Boolean(
    parsedVideo &&
      (editedTranscript !== parsedVideo.transcript ||
        editedVisualSummary !== parsedVideo.visualSummary)
  );

  const activeKnowledgeDocs = useMemo(
    () => knowledgeDocs.filter((d) => d.enabled),
    [knowledgeDocs]
  );

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setLinkInput(text);
    } catch {
      // ignore
    }
  };

  // ==========================================================================
  // 模式一（手动分步模式）：仅提取原视频文案与画面描述，供人工编辑后再触发二创
  // ==========================================================================
  const handleExtractOnly = async () => {
    const sourceState = useAppStore.getState();
    if (sourceState.isParsingVideo || sourceState.isGeneratingScript) return;
    const revision = sourceState.workbenchRevision;
    setParseError(null); setGenerateError(null); setExtractNotice(null); setIsParsingVideo(true);
    try {
      const parseRes = await parseVideoLinkClient(sourceState.linkInput, sourceState.settings);
      if (useAppStore.getState().workbenchRevision !== revision) return;
      if (parseRes.data) {
        const videoData = parseRes.data;
        setParsedVideo(videoData);
        if (videoData.durationSec > 0) setTargetDurationSec(Math.min(180, Math.max(6, Math.round(videoData.durationSec))));
        if (!sourceState.userCameraWork.trim() && videoData.suggestedCameraWork) setUserCameraWork(videoData.suggestedCameraWork);
      }
      if (!parseRes.success || !parseRes.data) {
        setParseError(parseRes.errorMessage || '提取失败，请检查链接、厂商权限或余额后手动重试。');
        return;
      }
      setExtractNotice(parseRes.isMockData ? '当前为示例数据，请关闭仿真模式后使用真实接口。'
        : parseRes.data.transcript.trim()
          ? '提取已完成，请查看完整性提示并核对口播，再生成二创稿；二创不会重复提取视频。'
          : '正文／图文已提取，未返回口播；可将正文与 OCR 填入编辑区，核对修改后再二创。');
    } catch {
      if (useAppStore.getState().workbenchRevision === revision) setParseError('提取请求失败，请检查网络和账号状态后手动重试。');
    } finally { setIsParsingVideo(false); }
  };

  // ==========================================================================
  // 基于左侧当前（人工修改后）文案，结合本公司业务与本地知识库开始二创
  // ==========================================================================
  const handleManualStartGenerate = async () => {
    const baseVideo: NonNullable<typeof parsedVideo> = parsedVideo || {
      platform: 'douyin',
      extractedUrl: linkInput || 'manual-input',
      title: editedTranscript.slice(0, 22) || '手动输入热点文案二创',
      author: '人工编辑输入',
      durationSec: targetDurationSec,
      transcript: editedTranscript,
      visualSummary: editedVisualSummary,
      suggestedCameraWork: userCameraWork,
    };

    if (!editedTranscript.trim()) {
      setParseError('请先提取视频链接或在左侧文本框中输入原热点视频文案。');
      return;
    }

    await triggerScriptGeneration({
      videoInfo: baseVideo,
      transcriptToUse: editedTranscript,
      visualSummaryToUse: editedVisualSummary,
      durationSec: targetDurationSec,
      cameraWork: userCameraWork,
    });
  };

  const triggerScriptGeneration = async (params: {
    videoInfo: NonNullable<typeof parsedVideo>;
    transcriptToUse: string;
    visualSummaryToUse: string;
    durationSec: number;
    cameraWork: string;
    refinementInstruction?: string;
  }) => {
    const sourceState = useAppStore.getState();
    if (sourceState.isGeneratingScript || sourceState.isParsingVideo) return;

    const { workbenchRevision } = sourceState;
    const isCurrentWorkbench = () => useAppStore.getState().workbenchRevision === workbenchRevision;
    const recordId = params.refinementInstruction && sourceState.currentEditingHistoryId
      ? sourceState.currentEditingHistoryId
      : `sqlite_${Date.now()}`;
    const previousVersions = params.refinementInstruction ? sourceState.refinementHistory : [];
    const previousScript = sourceState.streamingScriptText;
    const historyTurns = params.refinementInstruction
      ? [
          ...sourceState.conversationMessages,
          ...(sourceState.conversationMessages.length === 0 && previousScript
            ? [{ role: 'assistant' as const, content: previousScript }]
            : []),
        ]
      : [];

    setIsGeneratingScript(true);
    setGenerateError(null);
    sourceState.syncParsedScriptFromText('');
    if (!params.refinementInstruction) sourceState.clearRefinementHistory();

    let isSavingHistory = false;
    try {
      const systemPrompt = buildSystemPrompt();
      const userPrompt = buildUserPrompt({
        videoInfo: params.videoInfo,
        editedTranscript: params.transcriptToUse,
        editedVisualSummary: params.visualSummaryToUse,
        targetDurationSec: params.durationSec,
        userCameraWork: params.cameraWork,
        companyBusinessProfile: sourceState.settings.companyBusinessProfile,
        keywords: sourceState.keywords,
        knowledgeDocs: sourceState.knowledgeDocs,
        refinementInstruction: params.refinementInstruction,
      });
      const brandWords = sourceState.keywords.filter((k) => k.category === 'brand').map((k) => k.text);
      let finalFullText = '';
      const genRes = await streamGenerateScriptClient({
        settings: sourceState.settings,
        systemPrompt,
        userPrompt,
        conversationHistory: historyTurns,
        targetDurationSec: params.durationSec,
        userCameraWork: params.cameraWork,
        companyBusinessProfile: sourceState.settings.companyBusinessProfile,
        brandKeywords: brandWords,
        refinementInstruction: params.refinementInstruction,
        onChunk: (chunk) => {
          finalFullText += chunk;
          if (isCurrentWorkbench()) appendStreamingChunk(chunk);
        },
      });
      if (!genRes.success) {
        throw new Error(genRes.error || '生成二创脚本失败，请检查大模型 API 配置。');
      }

      const completedScript = genRes.fullText || finalFullText;
      if (!completedScript.trim()) throw new Error('模型未返回有效脚本，请重试。');
      const nextConversation = [
        ...historyTurns,
        { role: 'user' as const, content: userPrompt },
        { role: 'assistant' as const, content: completedScript },
      ];
      const versionLabel = params.refinementInstruction
        || (params.transcriptToUse !== params.videoInfo.transcript || params.visualSummaryToUse !== params.videoInfo.visualSummary
          ? '基于人工修订文案 + 本公司业务知识库生成'
          : '初始结合本公司业务与知识库生成版本');
      const nextVersions = [...previousVersions, {
        id: `ver_${Date.now()}`,
        round: previousVersions.length + 1,
        instruction: versionLabel,
        timestamp: new Date().toISOString(),
        scriptSnapshot: completedScript,
        conversationMessages: nextConversation,
      }];
      const record: HistoryRecord = {
        id: recordId,
        platform: params.videoInfo.platform,
        sourceUrl: params.videoInfo.extractedUrl,
        title: params.videoInfo.title || '短视频二创脚本',
        createdAt: new Date().toISOString(),
        durationSec: params.durationSec,
        userCameraWork: params.cameraWork,
        originalTranscript: params.transcriptToUse,
        sourceContent: { ...params.videoInfo },
        visualSummary: params.visualSummaryToUse,
        rawGeneratedScript: completedScript,
        parsedStructure: parseGeneratedScript(completedScript),
        refinementHistory: nextVersions,
        conversationMessages: nextConversation,
      };
      if (isCurrentWorkbench()) {
        useAppStore.setState({
          streamingScriptText: completedScript,
          parsedScript: record.parsedStructure,
          conversationMessages: nextConversation,
          refinementHistory: nextVersions,
        });
      }
      isSavingHistory = true;
      await saveGeneratedHistory(record, workbenchRevision);
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成二创脚本失败';
      setGenerateError(isSavingHistory ? `脚本已生成，但保存历史失败：${message}` : message);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleRefineSubmit = async (instruction: string) => {
    if (!parsedVideo) return;
    await triggerScriptGeneration({
      videoInfo: parsedVideo,
      transcriptToUse: editedTranscript,
      visualSummaryToUse: editedVisualSummary,
      durationSec: targetDurationSec,
      cameraWork: userCameraWork,
      refinementInstruction: instruction,
    });
  };

  // 计算 PRD V1.1【输出前自查项】9项合规状态
  const complianceChecks = useMemo(() => {
    if (!parsedScript) return [];
    return runScriptComplianceChecks(
      parsedScript,
      targetDurationSec,
      userCameraWork,
      keywords,
      settings.companyBusinessProfile
    );
  }, [
    parsedScript,
    targetDurationSec,
    userCameraWork,
    keywords,
    settings.companyBusinessProfile,
  ]);

  const allChecksPassed =
    complianceChecks.length > 0 && complianceChecks.every((c) => c.passed);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
      {/* 先提取、人工检查，再单独生成二创 */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 space-y-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1">
            <Link2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text" name="sourceVideoUrl"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="在此粘贴抖音或小红书当下热点视频分享链接（支持直接粘贴带口令的整段文本）..."
              className="w-full pl-10 pr-24 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
            />
            <button
              type="button"
              onClick={handlePasteFromClipboard}
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              粘贴
            </button>
          </div>

          <button
            type="button" data-testid="extract-video"
            onClick={handleExtractOnly}
            disabled={isParsingVideo || isGeneratingScript || !linkInput.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 shadow-sm transition-all shrink-0"
            title="提取发布文案和口播；再次点击会重新调用厂商接口"
          >
            {isParsingVideo ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {isParsingVideo ? '正在提取文案与口播...' : '提取文案与口播'}
          </button>
        </div>

        {/* 辅助参数、本公司业务锚点状态与示例切换栏 */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-600 font-medium">目标总时长(秒)：</span>
              <input
                type="number"
                min={6}
                max={180}
                value={targetDurationSec}
                onChange={(e) =>
                  setTargetDurationSec(Math.max(6, Number(e.target.value) || 18))
                }
                className="w-16 px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-center focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-600 font-medium">指定运镜(100%复用)：</span>
              <input
                type="text"
                value={userCameraWork}
                onChange={(e) => setUserCameraWork(e.target.value)}
                placeholder="例如：近景俯拍、特写推进、中景平视跟随"
                className="w-64 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <button
              type="button"
              onClick={() => setActiveNav('settings')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50/80 text-indigo-700 border border-indigo-100 hover:bg-indigo-100/80 transition-colors"
              title="点击前往设置页修改本公司主营业务、关键词与知识库"
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span className="truncate max-w-[200px]">
                业务锚点：{settings.companyBusinessProfile.slice(0, 16)}...
              </span>
              <span className="px-1.5 py-0.2 rounded bg-white text-[10px] font-semibold">
                {activeKnowledgeDocs.length}份知识库已注入
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-slate-500">
            <span>演示热点：</span>
            <button
              type="button"
              onClick={() =>
                setLinkInput(
                  '7.53 复制打开抖音，看看【阿泽的效率工坊】作品 https://v.douyin.com/iY8demo9/'
                )
              }
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
            >
              抖音早八热点
            </button>
            <button
              type="button"
              onClick={() =>
                setLinkInput(
                  '小户型书房改造笔记 http://xhslink.com/a/9xDemo21 复制本条消息打开小红书'
                )
              }
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-rose-50 hover:text-rose-600 transition-colors"
            >
              小红书桌面改造热点
            </button>
          </div>
        </div>

        {/* 仅提取模式成功提示横幅 */}
        {extractNotice && (
          <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{extractNotice}</span>
            </div>
            <button
              onClick={() => setExtractNotice(null)}
              className="text-emerald-600 hover:text-emerald-900 font-medium"
            >
              知道了
            </button>
          </div>
        )}

        {/* 错误提示横幅 */}
        {(parseError || generateError) && (
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{parseError || generateError}</span>
            </div>
            <button
              onClick={() => {
                setParseError(null);
                setGenerateError(null);
              }}
              className="text-red-500 hover:text-red-800 font-medium"
            >
              关闭
            </button>
          </div>
        )}
      </header>

      {/* 主体双栏工作区：左侧原视频提取与手动编辑区 (4列) + 右侧二创内容主视觉 (8列) */}
      <div className="flex-1 grid grid-cols-12 gap-5 p-6 overflow-hidden">
        {/* 左侧：提取结果展示与人工编辑区 (4列) */}
        <section className="col-span-4 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-900">
                原视频提取与人工修订区
              </h2>
              {isManuallyEdited && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  已人工修改
                </span>
              )}
            </div>
            {parsedVideo && (
              <span
                className={cn(
                  'text-[11px] font-semibold px-2.5 py-0.5 rounded-full',
                  parsedVideo.platform === 'douyin'
                    ? 'bg-slate-900 text-white'
                    : 'bg-rose-500 text-white'
                )}
              >
                {parsedVideo.platform === 'douyin' ? '抖音热点' : '小红书热点'}
              </span>
            )}
          </div>

          {isParsingVideo ? (
            <div className="p-5 space-y-4 animate-pulse flex-1">
              <div className="h-4 bg-slate-200 rounded w-3/4" />
              <div className="h-3 bg-slate-100 rounded w-1/2" />
              <div className="space-y-2 pt-3">
                <div className="h-3 bg-slate-100 rounded" />
                <div className="h-3 bg-slate-100 rounded" />
                <div className="h-3 bg-slate-100 rounded w-5/6" />
              </div>
            </div>
          ) : (
            <div className="p-4 flex-1 flex flex-col gap-3 overflow-y-auto">
              {parsedVideo && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                  <div className="text-xs font-semibold text-slate-800 line-clamp-1">
                    {parsedVideo.title}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>原作者：{parsedVideo.author}</span>
                    <span>原片时长：{parsedVideo.durationSec > 0 ? parsedVideo.durationSec + ' 秒' : '未知'}</span>
                  </div>
                </div>
              )}

              {parsedVideo && <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                <h3 className="text-xs font-semibold text-slate-700">发布文案（原始标题／描述）</h3>
                <p data-testid="published-text" className="max-h-28 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{parsedVideo.publishedText || '接口未返回发布文案'}</p>
                {parsedVideo.transcriptionStatus && <p role="status" className="text-[11px] text-slate-500">{parsedVideo.transcriptionStatus === 'succeeded' ? '口播转写成功，请核对品牌、数字和漏句。' : parsedVideo.transcriptionMessage || '口播待人工核对补全。'}</p>}
                <details className="text-xs text-slate-600"><summary className="cursor-pointer">查看原始口播（未修改）</summary>
                  <p data-testid="original-transcript" className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap">{parsedVideo.transcript || '未取得口播文字'}</p>
                </details>
              </div>}
              {parsedVideo && <ExtractedContentDetails content={parsedVideo} onUseText={setEditedTranscript} />}
              {/* 可编辑口播文案框 */}
              <div className="flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    原视频口播文案（可直接手动编辑修改）
                  </label>
                  <div className="flex items-center gap-2">
                    {isManuallyEdited && (
                      <button
                        type="button"
                        onClick={resetEditedToOriginal}
                        className="inline-flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 font-medium"
                      >
                        <RotateCcw className="w-3 h-3" />
                        恢复原始提取
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCopy(editedTranscript, 'transcript')}
                      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
                    >
                      {copiedKey === 'transcript' ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> 已复制
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> 复制
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <textarea
                  data-testid="editable-transcript"
                  value={editedTranscript}
                  onChange={(e) => setEditedTranscript(e.target.value)}
                  placeholder="提取的原视频口播文案将显示在此处，你可以手动增删修改后再点击下方按钮开始二创..."
                  className="w-full flex-1 min-h-[140px] rounded-xl bg-white border border-slate-200 p-3 text-xs leading-relaxed text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              {/* 可编辑画面描述框 */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  原片画面与镜头概要（可手动编辑补充）
                </label>
                <textarea
                  rows={3}
                  value={editedVisualSummary}
                  onChange={(e) => setEditedVisualSummary(e.target.value)}
                  placeholder="原片画面描述，可手动补充希望保留的视觉动作..."
                  className="w-full rounded-xl bg-white border border-slate-200 p-2.5 text-xs text-slate-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              {/* 手动触发二创主按钮 */}
              <div className="pt-1">
                <button
                  type="button"
                  data-testid="generate-script"
                  onClick={handleManualStartGenerate}
                  disabled={isParsingVideo || isGeneratingScript || !editedTranscript.trim()}
                  className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shadow-sm flex items-center justify-center gap-2 transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  {isGeneratingScript ? 'AI 结合业务二创中...' : isManuallyEdited
                    ? '基于人工修改后的文案 · 结合本公司业务开始二创'
                    : '结合本公司业务与知识库 · 开始生成二创脚本'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 右侧：二创内容展示区 (8列主视觉) */}
        <section className="col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <Tabs.Root
            value={activeOutputTab}
            onValueChange={(v) => setActiveOutputTab(v as any)}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {/* 顶部模块切换栏与多轮优化按钮 */}
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
              <Tabs.List className="flex items-center gap-1.5 bg-slate-100/90 p-1 rounded-xl">
                <Tabs.Trigger
                  value="storyboard"
                  className={cn(
                    'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
                    activeOutputTab === 'storyboard'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  <Video className="w-3.5 h-3.5" />
                  1. 拍摄脚本 ({parsedScript?.shots.length || 0}镜头)
                </Tabs.Trigger>

                <Tabs.Trigger
                  value="techniques"
                  className={cn(
                    'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
                    activeOutputTab === 'techniques'
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
                    'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
                    activeOutputTab === 'voiceover'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  <Mic className="w-3.5 h-3.5" />
                  3. 口播稿
                </Tabs.Trigger>

                <Tabs.Trigger
                  value="raw"
                  className={cn(
                    'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
                    activeOutputTab === 'raw'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  <FileText className="w-3.5 h-3.5" />
                  标准格式全文 & 9项自查
                </Tabs.Trigger>
              </Tabs.List>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(streamingScriptText, 'full-script')}
                  disabled={!streamingScriptText}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {copiedKey === 'full-script' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      已复制全文
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      复制脚本
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setOptimizeOpen(true)}
                  disabled={!streamingScriptText || isGeneratingScript}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-colors"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  多轮对话优化 ({refinementHistory.length}轮)
                </button>
              </div>
            </div>

            {/* Tab 1: 拍摄脚本 */}
            <Tabs.Content
              value="storyboard"
              className="flex-1 overflow-y-auto p-5 space-y-4 focus:outline-none"
            >
              {/* 总览条 */}
              <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-indigo-50/70 border border-indigo-100">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-950">
                  <span>
                    【分镜脚本总览】共 {parsedScript?.shots.length || 0} 个镜头，总时长{' '}
                    {parsedScript?.totalDurationSec || targetDurationSec} 秒
                  </span>
                  {isGeneratingScript && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[11px] font-medium animate-pulse">
                      流式生成中...
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <ShieldCheck
                    className={cn(
                      'w-4 h-4',
                      allChecksPassed ? 'text-emerald-600' : 'text-amber-600'
                    )}
                  />
                  <span
                    className={cn(
                      'font-medium',
                      allChecksPassed ? 'text-emerald-700' : 'text-amber-700'
                    )}
                  >
                    9项输出自查：{complianceChecks.filter((c) => c.passed).length}/
                    {complianceChecks.length} 项通过
                  </span>
                </div>
              </div>

              {/* 分镜卡片列表 */}
              {parsedScript && parsedScript.shots.length > 0 ? (
                <div className="space-y-3">
                  {parsedScript.shots.map((shot) => (
                    <div
                      key={shot.shotNumber}
                      className="rounded-xl border border-slate-200 bg-white hover:border-indigo-200 transition-all overflow-hidden shadow-sm"
                    >
                      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900">
                          【镜头{shot.shotNumber} | {shot.timeRange}】
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600">
                          镜头时长：{shot.durationSec}秒
                        </span>
                      </div>

                      <div className="p-4 space-y-2.5 text-xs leading-relaxed">
                        <div className="flex items-start gap-2">
                          <span className="font-semibold text-slate-900 shrink-0">
                            ▪️人员动作分工：
                          </span>
                          <span className="text-slate-700">
                            {shot.actionDivision}
                          </span>
                        </div>

                        <div className="flex items-start gap-2">
                          <span className="font-semibold text-slate-900 shrink-0">
                            ▪️运镜与拍摄执行标准：
                          </span>
                          <span className="text-slate-700">
                            {shot.cameraExecution}
                          </span>
                        </div>

                        <div className="flex items-start gap-2">
                          <span className="font-semibold text-slate-900 shrink-0">
                            ▪️声音内容：
                          </span>
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded',
                              shot.isAmbientOnly
                                ? 'bg-amber-50 text-amber-800 font-medium'
                                : 'bg-indigo-50/70 text-indigo-950 font-medium'
                            )}
                          >
                            {shot.audioContent}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs whitespace-pre-wrap text-slate-700">
                  {streamingScriptText || '等待生成二创分镜脚本...'}
                </div>
              )}

              {/* Phase 3: 多轮对话迭代历史版本条（支持点击直接回退到任意一轮） */}
              {refinementHistory.length > 0 && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-indigo-600" />
                      多轮对话迭代版本历史（点击任意轮次可一键回退脚本版本）
                    </span>
                    <span className="text-[11px] text-slate-400">
                      已挂载 {activeKnowledgeDocs.length} 份本地知识库
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {refinementHistory.map((ver) => {
                      const isCurrent =
                        ver.scriptSnapshot === streamingScriptText;
                      return (
                        <button
                          key={ver.id}
                          type="button"
                          onClick={() => rollbackToVersion(ver)}
                          className={cn(
                            'text-[11px] px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1.5',
                            isCurrent
                              ? 'bg-indigo-600 text-white border-indigo-600 font-semibold shadow-sm'
                              : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300'
                          )}
                          title={`生成于 ${formatDateTime(ver.timestamp)}，点击切换到该轮版本`}
                        >
                          <span>第{ver.round}轮：{ver.instruction}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </Tabs.Content>

            {/* Tab 2: 拍摄手法 */}
            <Tabs.Content
              value="techniques"
              className="flex-1 overflow-y-auto p-5 space-y-4 focus:outline-none"
            >
              <div className="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-100 text-xs text-indigo-900 flex items-center justify-between">
                <span>
                  <strong>核心运镜基准（100%复用用户输入）：</strong>
                  {userCameraWork}
                </span>
                <span className="text-[11px] text-indigo-600 font-medium">
                  禁止一镜到底 · 首帧动线连贯
                </span>
              </div>

              <div className="space-y-3">
                {parsedScript?.shootingTechniquesSummary.map((item) => (
                  <div
                    key={item.shotNumber}
                    className="p-4 rounded-xl border border-slate-200 bg-white space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900">
                        镜头 {item.shotNumber}（{item.timeRange}）拍摄执行与运镜手法
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      <strong>运镜与灯光标准：</strong>
                      {item.cameraStandard}
                    </p>
                    <p className="text-xs text-slate-500 bg-slate-50 px-3 py-2 rounded-lg">
                      <strong>镜头衔接与节奏建议：</strong>
                      {item.transitionAdvice}
                    </p>
                  </div>
                ))}
              </div>
            </Tabs.Content>

            {/* Tab 3: 口播稿 */}
            <Tabs.Content
              value="voiceover"
              className="flex-1 overflow-y-auto p-5 space-y-4 focus:outline-none"
            >
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900">
                    结合本公司业务润色后完整口播纯文本（可直接提词器朗读）
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        parsedScript?.voiceoverFullText || '',
                        'voiceover-only'
                      )
                    }
                    className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    {copiedKey === 'voiceover-only' ? (
                      <>
                        <Check className="w-3.5 h-3.5" /> 已复制口播稿
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> 复制纯口播稿
                      </>
                    )}
                  </button>
                </div>
                <div className="p-3.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                  {parsedScript?.voiceoverFullText}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-700">
                  分镜头声音与环境音匹配明细
                </h4>
                {parsedScript?.voiceoverSegments.map((seg) => (
                  <div
                    key={seg.shotNumber}
                    className="flex items-start justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-white text-xs"
                  >
                    <span className="font-semibold text-slate-800 shrink-0">
                      镜头{seg.shotNumber} ({seg.timeRange})
                    </span>
                    <span
                      className={cn(
                        'flex-1',
                        seg.isAmbientOnly
                          ? 'text-amber-700 font-medium'
                          : 'text-slate-700'
                      )}
                    >
                      {seg.content}
                    </span>
                  </div>
                ))}
              </div>
            </Tabs.Content>

            {/* Tab 4: PRD 标准输出格式原文与 9 项输出前自查面板 */}
            <Tabs.Content
              value="raw"
              className="flex-1 overflow-y-auto p-5 space-y-4 focus:outline-none"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-800">
                    PRD 标准格式纯文本输出（零多余内容，可直接复制交付）
                  </span>
                </div>
                <pre className="p-4 rounded-xl bg-slate-900 text-slate-100 text-xs leading-relaxed whitespace-pre-wrap font-sans overflow-x-auto">
                  {streamingScriptText}
                </pre>
              </div>

              {/* 9项自查清单 */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="text-xs font-bold text-slate-900">
                  【输出前自查项】实时合规检测（含热点×本公司业务融合自查）
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {complianceChecks.map((check) => (
                    <div
                      key={check.id}
                      className={cn(
                        'p-2.5 rounded-lg border text-xs flex items-start gap-2',
                        check.passed
                          ? 'bg-white border-emerald-200/80 text-slate-800'
                          : 'bg-amber-50 border-amber-300 text-amber-900'
                      )}
                    >
                      <CheckCircle2
                        className={cn(
                          'w-4 h-4 shrink-0 mt-0.5',
                          check.passed ? 'text-emerald-600' : 'text-amber-600'
                        )}
                      />
                      <div>
                        <div className="font-semibold">{check.label}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {check.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </section>
      </div>

      {/* Phase 3: 多轮对话式迭代优化弹窗 */}
      <OptimizeDialog
        open={optimizeOpen}
        onOpenChange={setOptimizeOpen}
        onSubmitInstruction={handleRefineSubmit}
        onRollbackVersion={rollbackToVersion}
        refinementHistory={refinementHistory}
        isGenerating={isGeneratingScript}
      />
    </div>
  );
};
