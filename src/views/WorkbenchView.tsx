import { useState, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ClipboardPaste,
  Link2,
  LoaderCircle,
  ArrowRight,
  ArrowUpRight,
  RotateCcw,
  X,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { parseVideoLinkClient, streamGenerateScriptClient } from '../services/ipcClient';
import { buildSystemPrompt, buildUserPrompt } from '../lib/promptBuilder';
import { parseGeneratedScript, runScriptComplianceChecks } from '../lib/scriptParser';
import type { HistoryRecord } from '../types';
import { ExtractedContentDetails } from '../components/ExtractedContentDetails';
import { OptimizeDialog } from '../components/OptimizeDialog';
import { Composer } from '../components/composer/Composer';
import { ScriptResult } from '../components/message/ScriptResult';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/utils';
import { getTranscriptionNotice } from '../lib/extractionNotices';
import { getVideoLinkError } from '../../electron/services/videoLink';
import { notifyError } from '../components/ui/Toast';

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
    setParseError: updateParseError,
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
    setGenerateError: updateGenerateError,
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

  const setParseError = (message: string | null) => {
    updateParseError(message);
    if (message) notifyError(message, '链接或素材处理未完成');
  };
  const setGenerateError = (message: string | null) => {
    updateGenerateError(message);
    if (message) notifyError(message, '脚本操作未完成');
  };
  const acceptPastedLink = (text: string) => {
    setLinkInput(text);
    setParseError(getVideoLinkError(text));
  };
  const linkInputRef = useRef<HTMLInputElement>(null);
  const transcriptionNotice = getTranscriptionNotice(parsedVideo);
  const [mobileStep, setMobileStep] = useState<'source' | 'result'>('source');
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
      setGenerateError('复制失败，请选择文字后手动复制。');
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { setParseError('剪贴板为空，请先复制抖音或小红书分享链接。'); return; }
      acceptPastedLink(text);
    } catch {
      setParseError('无法读取剪贴板，请在链接框按 Ctrl+V，或使用右键菜单粘贴。');
    }
  };

  // ==========================================================================
  // 模式一（手动分步模式）：仅提取原视频文案与画面描述，供人工编辑后再触发二创
  // ==========================================================================
  const handleExtractOnly = async () => {
    const sourceState = useAppStore.getState();
    if (sourceState.isParsingVideo || sourceState.isGeneratingScript) return;
    const linkError = getVideoLinkError(sourceState.linkInput);
    if (linkError) { setParseError(linkError); return; }
    const revision = sourceState.workbenchRevision;
    setParseError(null);
    setGenerateError(null);
    setExtractNotice(null);
    setIsParsingVideo(true);
    try {
      const parseRes = await parseVideoLinkClient(sourceState.linkInput, sourceState.settings);
      if (useAppStore.getState().workbenchRevision !== revision) return;
      if (parseRes.data) {
        const videoData = parseRes.data;
        setParsedVideo(videoData);
        if (videoData.durationSec > 0)
          setTargetDurationSec(Math.min(180, Math.max(6, Math.round(videoData.durationSec))));
        if (!sourceState.userCameraWork.trim() && videoData.suggestedCameraWork)
          setUserCameraWork(videoData.suggestedCameraWork);
      }
      if (!parseRes.success || !parseRes.data) {
        setParseError(parseRes.errorMessage || '提取失败，请检查链接、厂商权限或余额后手动重试。');
        return;
      }
      setExtractNotice(
        parseRes.isMockData
          ? '当前为示例数据，请关闭仿真模式后使用真实接口。'
          : parseRes.data.transcript.trim()
            ? '提取已完成，请查看完整性提示并核对口播，再生成二创稿；二创不会重复提取视频。'
            : '正文／图文已提取，未返回口播；可将正文与图片文字 填入编辑区，核对修改后再二创。'
      );
    } catch (error) {
      if (useAppStore.getState().workbenchRevision === revision)
        setParseError(error instanceof Error && /[\u4e00-\u9fff]/u.test(error.message) ? error.message : '提取请求失败，请检查网络和账号状态后手动重试。');
    } finally {
      setIsParsingVideo(false);
    }
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

    setMobileStep('result');
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
    const recordId =
      params.refinementInstruction && sourceState.currentEditingHistoryId
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
      const brandWords = sourceState.keywords
        .filter((k) => k.category === 'brand')
        .map((k) => k.text);
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
        throw new Error(genRes.error || '生成二创脚本失败，请检查模型接口配置。');
      }

      const completedScript = genRes.fullText || finalFullText;
      if (!completedScript.trim()) throw new Error('模型未返回有效脚本，请重试。');
      const nextConversation = [
        ...historyTurns,
        { role: 'user' as const, content: userPrompt },
        { role: 'assistant' as const, content: completedScript },
      ];
      const versionLabel =
        params.refinementInstruction ||
        (params.transcriptToUse !== params.videoInfo.transcript ||
        params.visualSummaryToUse !== params.videoInfo.visualSummary
          ? '基于人工修订文案 + 本公司业务知识库生成'
          : '初始结合本公司业务与知识库生成版本');
      const nextVersions = [
        ...previousVersions,
        {
          id: `ver_${Date.now()}`,
          round: previousVersions.length + 1,
          instruction: versionLabel,
          timestamp: new Date().toISOString(),
          scriptSnapshot: completedScript,
          conversationMessages: nextConversation,
        },
      ];
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
    const videoInfo = parsedVideo || {
      platform: 'douyin' as const,
      extractedUrl: linkInput || 'manual-input',
      title: editedTranscript.slice(0, 22) || '手动输入文案',
      author: '人工编辑输入',
      durationSec: targetDurationSec,
      transcript: editedTranscript,
      visualSummary: editedVisualSummary,
      suggestedCameraWork: userCameraWork,
    };
    await triggerScriptGeneration({
      videoInfo,
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
  }, [parsedScript, targetDurationSec, userCameraWork, keywords, settings.companyBusinessProfile]);

  const busy = isParsingVideo || isGeneratingScript;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b bg-card px-4 py-4 md:px-6">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-sm font-semibold tracking-tight">创作工作台</h1>
          {settings.enableMockFallback && (
            <button
              type="button"
              onClick={() => setActiveNav('settings', 'system')}
              className="rounded border px-2 py-0.5 text-[11px] text-muted-foreground"
              title="前往系统设置切换为真实接口"
            >
              演示模式
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="source-video-url" className="sr-only">
              视频分享链接
            </label>
            <input
              ref={linkInputRef}
              id="source-video-url"
              name="sourceVideoUrl"
              type="text"
              value={linkInput}
              disabled={busy}
              onChange={(event) => { setLinkInput(event.target.value); updateParseError(null); }}
              onPaste={(event) => {
                const input = event.currentTarget;
                const text = event.clipboardData.getData('text/plain');
                const next = input.value.slice(0, input.selectionStart ?? 0) + text + input.value.slice(input.selectionEnd ?? input.value.length);
                setParseError(getVideoLinkError(next));
              }}
              placeholder="粘贴抖音或小红书分享链接"
              className="field h-11 pl-9 pr-12"
              onKeyDown={(event) => {
                if (
                  !event.nativeEvent.isComposing &&
                  event.key === 'Enter' &&
                  linkInput.trim() &&
                  !busy
                ) {
                  event.preventDefault();
                  void handleExtractOnly();
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!busy) {
                  const text = event.dataTransfer.getData('text/plain');
                  acceptPastedLink(text);
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={linkInput ? '清除链接' : '粘贴链接'}
              title={linkInput ? '清除链接' : '粘贴链接'}
              disabled={busy}
              onClick={() => {
                if (linkInput) {
                  setLinkInput('');
                  linkInputRef.current?.focus();
                } else {
                  void handlePasteFromClipboard();
                }
              }}
              className="absolute right-0 top-0"
            >
              {linkInput ? <X /> : <ClipboardPaste />}
            </Button>
          </div>
          <Button
            variant="primary"
            data-testid="extract-video"
            onClick={handleExtractOnly}
            disabled={busy || !linkInput.trim()}
            title="再次提取会重新调用厂商接口"
          >
            {isParsingVideo ? <LoaderCircle className="animate-spin" /> : null}
            {isParsingVideo ? '提取中' : '提取文案'}
          </Button>
        </div>
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer py-1">
            生成选项 <span className="ml-2 tabular-nums">{targetDurationSec} 秒</span>
          </summary>
          <div className="mt-3 flex flex-wrap items-end gap-4 pb-1">
            <div>
              <label htmlFor="target-duration" className="field-label">
                目标时长（秒）
              </label>
              <input
                id="target-duration"
                type="number"
                min={6}
                max={180}
                value={targetDurationSec}
                onChange={(event) =>
                  setTargetDurationSec(Math.min(180, Math.max(6, Number(event.target.value) || 18)))
                }
                className="field w-24"
              />
            </div>
            <div className="min-w-0 flex-1 basis-56">
              <label htmlFor="camera-work" className="field-label">
                指定运镜（可选）
              </label>
              <input
                id="camera-work"
                type="text"
                value={userCameraWork}
                onChange={(event) => setUserCameraWork(event.target.value)}
                placeholder="例如：近景俯拍、特写推进"
                className="field"
              />
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setActiveNav('settings')}
              title={settings.companyBusinessProfile || '前往设置填写业务背景'}
            >
              业务与知识库 <span className="tabular-nums">{activeKnowledgeDocs.length}</span>
              <ArrowUpRight />
            </Button>
            {settings.enableMockFallback && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setLinkInput('https://v.douyin.com/iY8demo9/')}
              >
                加载示例链接
              </Button>
            )}
          </div>
        </details>
        <AnimatePresence initial={false}>
          {(parseError || generateError || extractNotice) && (
            <motion.div
              key={parseError || generateError || extractNotice}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div
                role={parseError || generateError ? 'alert' : 'status'}
                className={cn(
                  'mt-3 flex items-start justify-between gap-2 rounded-md px-3 py-2 text-xs leading-relaxed',
                  parseError || generateError
                    ? 'bg-destructive/5 text-destructive'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                <p className="py-1">{parseError || generateError || extractNotice}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="关闭提示"
                  onClick={() => {
                    setParseError(null);
                    setGenerateError(null);
                    setExtractNotice(null);
                  }}
                  className="-mr-2 h-8 min-h-8 px-2"
                >
                  <X />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
      <div
        className="flex shrink-0 gap-1 border-b bg-card px-4 py-2 lg:hidden"
        aria-label="工作区切换"
      >
        <Button
          size="sm"
          variant={mobileStep === 'source' ? 'secondary' : 'ghost'}
          aria-pressed={mobileStep === 'source'}
          aria-controls="source-panel"
          onClick={() => setMobileStep('source')}
        >
          素材编辑
        </Button>
        <Button
          size="sm"
          variant={mobileStep === 'result' ? 'secondary' : 'ghost'}
          aria-pressed={mobileStep === 'result'}
          aria-controls="result-panel"
          onClick={() => setMobileStep('result')}
        >
          生成结果{isGeneratingScript && <LoaderCircle className="animate-spin" />}
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-3 md:p-5 lg:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)] lg:gap-5">
        <section
          id="source-panel"
          aria-label="素材编辑"
          className={cn(
            'surface min-h-0 flex-col overflow-hidden',
            mobileStep === 'source' ? 'flex' : 'hidden lg:flex'
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="section-title">素材</h2>
            <span className="text-xs text-muted-foreground">
              {isManuallyEdited
                ? '已编辑'
                : parsedVideo
                  ? parsedVideo.platform === 'douyin'
                    ? '抖音'
                    : '小红书'
                  : '粘贴链接或直接输入'}
            </span>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            {isParsingVideo && (
              <div role="status" className="status-note">
                <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
                正在提取，请保留当前页面…
              </div>
            )}
            {parsedVideo && (
              <>
                <div>
                  <h3 className="truncate text-sm font-medium" title={parsedVideo.title}>
                    {parsedVideo.title}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {parsedVideo.author}
                    {parsedVideo.durationSec > 0 && ' · ' + parsedVideo.durationSec + ' 秒'}
                  </p>
                </div>
                {transcriptionNotice && (
                  <p role="status" className="status-note text-warning">
                    {transcriptionNotice}
                  </p>
                )}
                <details className="disclosure">
                  <summary>原始素材</summary>
                  <div className="mt-3 space-y-4">
                    <div>
                      <h4 className="field-label">发布文案</h4>
                      <p data-testid="published-text" className="reading-text">
                        {parsedVideo.publishedText || '未返回发布文案'}
                      </p>
                    </div>
                    <div>
                      <h4 className="field-label">原始口播</h4>
                      <p data-testid="original-transcript" className="reading-text">
                        {parsedVideo.transcript || '未取得口播文字'}
                      </p>
                    </div>
                  </div>
                </details>
                <ExtractedContentDetails content={parsedVideo} onUseText={setEditedTranscript} />
              </>
            )}
            <div>
              <Composer
                label="口播文案"
                data-testid="editable-transcript"
                value={editedTranscript}
                onValueChange={setEditedTranscript}
                busy={busy}
                onSubmit={() => {
                  void handleManualStartGenerate();
                }}
                placeholder="在这里核对提取的口播，或直接输入你想改写的文案。"
                minHeight={180}
                maxHeight={480}
                hint="核对人名、品牌与数字后再生成"
              />
              {isManuallyEdited && (
                <div className="mt-1 flex justify-end">
                  <Button size="sm" variant="ghost" disabled={busy} onClick={resetEditedToOriginal}>
                    <RotateCcw />
                    恢复原始提取
                  </Button>
                </div>
              )}
            </div>
            <details className="disclosure" open={editedVisualSummary.trim() ? true : undefined}>
              <summary>
                画面描述 <span className="ml-1 font-normal text-muted-foreground">可选</span>
              </summary>
              <label htmlFor="visual-summary" className="sr-only">
                画面与镜头描述
              </label>
              <textarea
                id="visual-summary"
                rows={3}
                value={editedVisualSummary}
                disabled={busy}
                onChange={(event) => setEditedVisualSummary(event.target.value)}
                placeholder="补充希望保留的画面、动作或镜头。"
                className="field mt-3 resize-y"
              />
            </details>
          </div>
          <footer className="shrink-0 border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              variant="primary"
              className="w-full"
              data-testid="generate-script"
              disabled={busy || !editedTranscript.trim()}
              onClick={handleManualStartGenerate}
            >
              {isGeneratingScript ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
              {isGeneratingScript ? '生成中…' : '生成二创脚本'}
            </Button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {isManuallyEdited ? '基于人工修改后的文案' : '使用当前口播与业务设置'}
              <span className="hidden xl:inline"> · Ctrl + 回车</span>
            </p>
          </footer>
        </section>
        <section
          id="result-panel"
          aria-label="脚本结果"
          className={cn(
            'surface min-h-0 flex-col overflow-hidden',
            mobileStep === 'result' ? 'flex' : 'hidden lg:flex'
          )}
        >
          <ScriptResult
            script={parsedScript}
            text={streamingScriptText}
            busy={isGeneratingScript}
            targetDuration={targetDurationSec}
            cameraWork={userCameraWork}
            checks={complianceChecks}
            onCopy={handleCopy}
            copiedKey={copiedKey}
            onOptimize={() => setOptimizeOpen(true)}
          />
        </section>
      </div>
      <OptimizeDialog
        open={optimizeOpen}
        onOpenChange={setOptimizeOpen}
        onSubmitInstruction={handleRefineSubmit}
        onRollbackVersion={rollbackToVersion}
        refinementHistory={refinementHistory}
        currentScript={streamingScriptText}
        isGenerating={isGeneratingScript}
      />
    </div>
  );
};
