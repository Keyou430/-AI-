import type { HistoryRecord, ParsedScriptStructure } from '../types';
import { isVisibleExtractionNotice } from './extractionNotices';
import { getEditableSourceText, isImageTextContent } from './extractedContent';

export const outputTabs = ['storyboard', 'techniques', 'voiceover', 'raw', 'source'] as const;
export type OutputTab = (typeof outputTabs)[number];

export function getScriptOutputText(
  tab: OutputTab,
  script: ParsedScriptStructure | null,
  text: string,
  cameraWork: string,
  source?: HistoryRecord
): string {
  if (tab === 'raw') return text;
  if (tab === 'storyboard')
    return script?.shots.length
      ? [
          '共 ' + script.shots.length + ' 个镜头 · ' + script.totalDurationSec + ' 秒',
          ...script.shots.map((shot) =>
            [
              '镜头 ' + shot.shotNumber + ' · ' + shot.timeRange,
              '画面与动作：' + shot.actionDivision,
              '运镜与灯光：' + shot.cameraExecution,
              (shot.isAmbientOnly ? '环境音：' : '声音：') + shot.audioContent,
            ].join('\n')
          ),
        ].join('\n\n')
      : text;
  if (tab === 'techniques')
    return [
      cameraWork && '指定运镜：' + cameraWork,
      ...(script?.shootingTechniquesSummary || []).map((item) =>
        [
          '镜头 ' + item.shotNumber + ' · ' + item.timeRange,
          item.cameraStandard,
          item.transitionAdvice,
        ]
          .filter(Boolean)
          .join('\n')
      ),
    ]
      .filter(Boolean)
      .join('\n\n');
  if (tab === 'voiceover')
    return [
      script?.voiceoverFullText,
      ...(script?.voiceoverSegments.length
        ? [
            '分镜声音明细',
            ...script.voiceoverSegments.map(
              (item) => '镜头 ' + item.shotNumber + ' · ' + item.timeRange + '\n' + item.content
            ),
          ]
        : []),
    ]
      .filter(Boolean)
      .join('\n\n');
  if (!source) return '';
  const content = source.sourceContent;
  const details = content?.extractionDetails;
  return [
    '本次二创输入（含人工修改）\n' + source.originalTranscript,
    ...(content
      ? [
          (isImageTextContent(content) ? '原始提取图文（未修改）\n' : '原始提取口播（未修改）\n') +
            (getEditableSourceText(content) || '未获得有效素材文字'),
          '原始发布文案\n' + (content.publishedText || '未返回发布文案'),
        ]
      : []),
    ...(details
      ? [
          ...details.warnings.filter(isVisibleExtractionNotice),
          '本次消耗：' +
            (details.credits === undefined ? '厂商未返回' : details.credits + ' 积分') +
            (details.cached ? '（缓存结果）' : ''),
          ...(details.coverage
            ? [
                '已转写 ' +
                  (details.coverage.secondsTranscribed ?? '未知') +
                  ' / ' +
                  (details.coverage.durationSeconds ?? '未知') +
                  ' 秒；已读取图片 ' +
                  (details.coverage.imagesRead ?? '未知') +
                  ' / ' +
                  (details.coverage.imagesTotal ?? '未知') +
                  ' 张。',
              ]
            : []),
          ...details.images.map((image, index) =>
            [
              '第 ' + (index + 1) + ' 张',
              image.ocr || '未返回图片文字',
              image.description && '智能图片描述：' + image.description,
            ]
              .filter(Boolean)
              .join('\n')
          ),
          details.ocrText.length && '图片文字汇总\n' + details.ocrText.join('\n'),
          ...details.onScreen.map(
            (item) => (item.t === null ? '时间未知' : item.t + ' 秒') + '：' + item.text
          ),
          details.keyPoints.length && '智能分析要点（不等于原文）\n' + details.keyPoints.join('\n'),
        ]
      : []),
  ]
    .filter(Boolean)
    .join('\n\n');
}
