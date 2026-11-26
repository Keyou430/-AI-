import { useEffect, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Check, Copy, LoaderCircle, ArrowDown, Wand2, Camera, AudioLines, ScanLine } from 'lucide-react';
import { motion } from 'motion/react';
import type { ComplianceCheckItem, HistoryRecord, ParsedScriptStructure } from '../../types';
import { ExtractedContentDetails } from '../ExtractedContentDetails';
import { getEditableSourceText, isImageTextContent } from '../../lib/extractedContent';
import { Button } from '../ui/Button';
import { ViewfinderEmptyState } from '../ui/ViewfinderEmptyState';
import { getScriptOutputText, outputTabs, type OutputTab } from '../../lib/scriptOutput';

interface ScriptResultProps {
  script: ParsedScriptStructure | null;
  text: string;
  busy: boolean;
  targetDuration: number;
  cameraWork: string;
  checks: ComplianceCheckItem[];
  onCopy: (text: string, key: string) => void;
  copiedKey: string | null;
  onOptimize?: () => void;
  source?: HistoryRecord;
  activeTab?: OutputTab;
  onTabChange?: (tab: OutputTab) => void;
  hideToolbar?: boolean;
}
const labels: Record<OutputTab, string> = {
  storyboard: '拍摄脚本',
  techniques: '拍摄手法',
  voiceover: '口播稿',
  raw: '全文',
  source: '原稿对照',
};
export function ScriptResult({
  script,
  text,
  busy,
  targetDuration,
  cameraWork,
  checks,
  onCopy,
  copiedKey,
  onOptimize,
  source,
  activeTab,
  onTabChange,
  hideToolbar = false,
}: ScriptResultProps) {
  const [localTab, setLocalTab] = useState<OutputTab>('storyboard');
  const tab = activeTab ?? localTab;
  const [shotPage, setShotPage] = useState(0);
  const totalShots = script?.shots.length || 0;
  const currentPage = Math.min(shotPage, Math.max(0, totalShots - 1));
  const copiedText = getScriptOutputText(tab, script, text, cameraWork, source);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setShotPage(0);
    if (!busy && scroll.current) scroll.current.scrollTop = 0;
  }, [source?.id, busy]);
  const follow = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  useEffect(() => {
    if (busy && follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [text, busy]);
  useEffect(() => {
    if (busy) follow.current = true;
  }, [busy]);
  const hasText = !!text.trim();
  const pendingChecks = checks.filter((item) => !item.passed);
  const passedChecks = checks.filter((item) => item.passed);
  return (
    <Tabs.Root
      value={tab}
      onValueChange={(value) => {
        if (outputTabs.some((item) => item === value)) {
          setLocalTab(value as OutputTab);
          onTabChange?.(value as OutputTab);
          if (scroll.current) scroll.current.scrollTop = 0;
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-2">
        <Tabs.List className="tab-list" aria-label="脚本视图">
          {outputTabs
            .filter((value) => value !== 'source' || source)
            .map((value) => (
              <Tabs.Tab key={value} value={value} className="tab px-2">
                {labels[value]}
              </Tabs.Tab>
            ))}
        </Tabs.List>
        {!busy && totalShots > 1 && (tab === 'storyboard' || tab === 'techniques') && (
          <nav aria-label="镜头分页" className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={currentPage === 0}
              aria-label="上一个镜头"
              onClick={() => {
                setShotPage(currentPage - 1);
                if (scroll.current) scroll.current.scrollTop = 0;
              }}
            >
              上一镜
            </Button>
            <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="sr-only">选择镜头</span>
              <select
                aria-label="选择镜头"
                className="field w-auto"
                value={currentPage}
                onChange={(event) => {
                  setShotPage(Number(event.target.value));
                  if (scroll.current) scroll.current.scrollTop = 0;
                }}
              >
                {script?.shots.map((shot, index) => (
                  <option key={shot.shotNumber} value={index}>
                    镜头 {shot.shotNumber}
                  </option>
                ))}
              </select>
              <span className="shrink-0">
                {currentPage + 1} / {totalShots}
              </span>
            </label>
            <Button
              size="sm"
              variant="ghost"
              disabled={currentPage === totalShots - 1}
              aria-label="下一个镜头"
              onClick={() => {
                setShotPage(currentPage + 1);
                if (scroll.current) scroll.current.scrollTop = 0;
              }}
            >
              下一镜
            </Button>
          </nav>
        )}
        {!hideToolbar && <div className="ml-auto flex items-center gap-1">
          {busy && <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground"><LoaderCircle size={13} className="animate-spin" />生成中</span>}
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onCopy(copiedText, tab)}
              disabled={!copiedText.trim()}
              aria-label={'复制' + labels[tab]}
            >
              {copiedKey === tab ? <Check /> : <Copy />}
              <span className="hidden sm:inline">{copiedKey === tab ? '已复制' : '复制'}</span>
            </Button>
            {onOptimize && (
              <Button
                size="sm"
                data-testid="optimize-script"
                disabled={!hasText || busy}
                onClick={onOptimize}
              >
                <Wand2 />
                优化脚本
              </Button>
            )}
          </div>

        </div>}
      </div>
      {!hasText && !busy ? (
        <Tabs.Panel
          value={tab}
          className="flex min-h-0 flex-1 overflow-y-auto p-3"
          data-testid="script-empty"
        >
          <ViewfinderEmptyState
            status="分镜监视器 · 待机"
            title="脚本将在这里呈现"
            description="先提取链接或输入口播，核对后生成你的二创脚本。"
            stepsLabel="脚本创作流程"
            steps={['提取素材', '核对台词', '生成分镜']}
          />
        </Tabs.Panel>
      ) : (
        <>
          <div className="relative min-h-0 flex-1">
            <div
              ref={scroll}
              data-testid="script-result-scroll"
              className="script-result-scroll h-full overflow-y-auto px-4 py-5 sm:px-6"
              onScroll={() => {
                const el = scroll.current;
                if (!el) return;
                follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                setShowLatest(busy && !follow.current);
              }}
            >
              <Tabs.Panel value="storyboard" className="focus-visible:outline-offset-[-2px]">
                {script?.shots.length ? (
                  <>
                    <p className="mb-4 text-xs tabular-nums text-muted-foreground">
                      {script.shots.length} 个镜头 <span className="mx-2 text-border">/</span>
                      {script.totalDurationSec || targetDuration} 秒
                    </p>
                    <div className="space-y-4">
                      {(busy ? script.shots : script.shots.slice(currentPage, currentPage + 1)).map(
                        (shot) => (
                          <article key={shot.shotNumber} className="surface overflow-hidden">
                            <header className="flex items-stretch border-b border-input bg-secondary/50">
                              <span className="inline-flex shrink-0 items-center bg-foreground px-4 py-3 font-mono text-xs font-semibold tabular-nums text-card">
                                镜头 {String(shot.shotNumber).padStart(2, '0')}
                              </span>
                              <span className="inline-flex items-center px-4 py-3 font-mono text-xs tabular-nums tracking-wider text-muted-foreground">
                                {shot.timeRange}
                              </span>
                            </header>
                            <dl className="shot-fields grid divide-y divide-border text-sm leading-[1.85]">
                              <div className="min-w-0 p-4">
                                <dt className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><ScanLine className="h-3.5 w-3.5" aria-hidden="true" />画面与动作</dt>
                                <dd className="break-words">{shot.actionDivision}</dd>
                              </div>
                              <div className="min-w-0 p-4">
                                <dt className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Camera className="h-3.5 w-3.5" aria-hidden="true" />运镜与灯光</dt>
                                <dd className="break-words">{shot.cameraExecution}</dd>
                              </div>
                              <div className="min-w-0 p-4">
                                <dt className="mb-2 flex items-center gap-1.5 border-l-2 border-primary pl-2 text-xs font-medium text-foreground"><AudioLines className="h-3.5 w-3.5" aria-hidden="true" />
                                  {shot.isAmbientOnly ? '环境音' : '声音'}
                                </dt>
                                <dd className="break-words">{shot.audioContent}</dd>
                              </div>
                            </dl>
                          </article>
                        )
                      )}
                    </div>
                  </>
                ) : (
                  <pre className="reading-text font-sans">{text || '正在整理脚本…'}</pre>
                )}
              </Tabs.Panel>
              <Tabs.Panel value="techniques">
                {cameraWork && (
                  <p className="mb-5 border-b pb-4 text-xs leading-relaxed text-muted-foreground">
                    指定运镜：{cameraWork}
                  </p>
                )}
                <div className="space-y-6">
                  {(busy
                    ? script?.shootingTechniquesSummary
                    : script?.shootingTechniquesSummary.filter(
                        (item) => item.shotNumber === script.shots[currentPage]?.shotNumber
                      )
                  )?.map((item) => (
                    <article key={item.shotNumber} className="border-b pb-5 last:border-0">
                      <h3 className="mb-3 text-sm font-medium">
                        镜头 {item.shotNumber}
                        <span className="ml-3 text-xs font-normal text-muted-foreground">
                          {item.timeRange}
                        </span>
                      </h3>
                      <p className="reading-text">{item.cameraStandard}</p>
                      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                        {item.transitionAdvice}
                      </p>
                    </article>
                  ))}
                </div>
              </Tabs.Panel>
              <Tabs.Panel value="voiceover">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-medium">完整口播</h3>
                  {!hideToolbar && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!script?.voiceoverFullText}
                      onClick={() => onCopy(script?.voiceoverFullText || '', 'voiceover-only')}
                    >
                      {copiedKey === 'voiceover-only' ? <Check /> : <Copy />}
                      {copiedKey === 'voiceover-only' ? '已复制' : '复制口播'}
                    </Button>
                  )}
                </div>
                <p className="reading-text">
                  {script?.voiceoverFullText ||
                    (busy ? '正在生成口播…' : '未解析到口播，请查看全文。')}
                </p>
                {!!script?.voiceoverSegments.length && (
                  <details className="disclosure mt-8">
                    <summary>分镜声音明细</summary>
                    <div className="mt-4 space-y-4">
                      {script.voiceoverSegments.map((segment) => (
                        <div key={segment.shotNumber}>
                          <p className="mb-1 text-xs text-muted-foreground">
                            镜头 {segment.shotNumber} · {segment.timeRange}
                          </p>
                          <p className="reading-text">{segment.content}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </Tabs.Panel>
              <Tabs.Panel value="raw">
                <pre className="reading-text font-sans">{text}</pre>
              </Tabs.Panel>
              {source && (
                <Tabs.Panel value="source">
                  <div className="space-y-6">
                    <div>
                      <h3 className="field-label">本次二创输入（含人工修改）</h3>
                      <p className="reading-text">{source.originalTranscript}</p>
                    </div>
                    {source.sourceContent && (
                      <>
                        <div>
                          <h3 className="field-label">{isImageTextContent(source.sourceContent) ? '原始提取图文（未修改）' : '原始提取口播（未修改）'}</h3>
                          <p className="reading-text">
                            {getEditableSourceText(source.sourceContent) || '未获得有效素材文字'}
                          </p>
                        </div>
                        <div>
                          <h3 className="field-label">原始发布文案</h3>
                          <p className="reading-text">
                            {source.sourceContent.publishedText || '未返回发布文案'}
                          </p>
                        </div>
                        <ExtractedContentDetails content={source.sourceContent} />
                      </>
                    )}
                  </div>
                </Tabs.Panel>
              )}
              {hasText && !busy && checks.length > 0 && (
                <details className="disclosure mt-6">
                  <summary>
                    格式与内容检查{' '}
                    <span className="ml-2 font-normal tabular-nums text-muted-foreground">{passedChecks.length}/{checks.length}</span>{' '}
                    {pendingChecks.length > 0 && <span className="ml-2 text-warning">{pendingChecks.length} 项待核对</span>}
                  </summary>
                  <p className="mt-2 muted-copy">自动检查仅供参考，发布前请人工核对。</p>
                  {pendingChecks.length > 0 && <ul className="mt-3 space-y-2">
                    {pendingChecks.map((check) => (
                      <li key={check.id} className="rounded-md border border-warning/15 bg-warning/5 px-3 py-2">
                        <p className="text-xs font-medium text-warning">待核对 · {check.label}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{check.detail}</p>
                      </li>
                    ))}
                  </ul>}
                  {passedChecks.length > 0 && <details className="mt-3 border-t border-divider pt-2">
                    <summary className="w-fit cursor-pointer py-1 text-xs text-muted-foreground">已通过 {passedChecks.length} 项</summary>
                    <ul className="mt-2 space-y-2">
                      {passedChecks.map((check) => (
                        <li key={check.id} className="rounded-md bg-surface-muted px-3 py-2">
                          <p className="text-xs font-medium">通过 · {check.label}</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{check.detail}</p>
                        </li>
                      ))}
                    </ul>
                  </details>}
                </details>
              )}
            </div>
            {showLatest && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-4 right-5"
              >
                <Button
                  size="sm"
                  className="bg-card shadow-sm"
                  onClick={() => {
                    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
                    follow.current = true;
                    setShowLatest(false);
                  }}
                >
                  <ArrowDown />
                  查看最新内容
                </Button>
              </motion.div>
            )}
          </div>
        </>
      )}
    </Tabs.Root>
  );
}
