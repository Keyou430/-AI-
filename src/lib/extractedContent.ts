import type { ParsedVideoInfo } from '../types';

/** 保留原始正文和图片文字，智能分析要点不作为原文填入。 */
export function getExtractedText(content: ParsedVideoInfo): string {
  const details = content.extractionDetails;
  const imageText = details?.images.flatMap((image, index) =>
    image.ocr.trim() ? ['第' + (index + 1) + '张图片文字：\n' + image.ocr.trim()] : []
  ) || [];
  return [
    content.publishedText || '',
    ...(imageText.length ? imageText : details?.ocrText || []),
    ...(details?.onScreen.map(item => item.text) || []),
  ].map(text => text.trim()).filter(Boolean).join('\n\n');
}

/** 判断可用的图文结果，不把已知视频的口播提取失败当作图文成功。 */
export function isImageTextContent(content: ParsedVideoInfo | null): boolean {
  if (!content || content.transcript.trim()) return false;
  if (content.transcriptionStatus === 'not_video') return true;
  const details = content.extractionDetails;
  return content.transcriptionStatus !== 'failed' && content.durationSec === 0 &&
    Boolean(details && (details.images.length || details.ocrText.length) && getExtractedText(content).trim());
}

export function getEditableSourceText(content: ParsedVideoInfo | null): string {
  if (!content) return '';
  return isImageTextContent(content) ? getExtractedText(content) : content.transcript;
}

/** 优先使用接口标签，旧结果从原文话题标签补齐；不生成或猜测关键词。 */
export function getSourceKeywords(content: ParsedVideoInfo): string[] {
  const hashtags = Array.from(getExtractedText(content).matchAll(/#([^#\s\[\]，,。！？!?：:]+)(?:\[话题\])?/gu), match => match[1]);
  return Array.from(new Set([...(content.extractionDetails?.tags || []), ...hashtags]
    .map(tag => tag.trim()).filter(Boolean)));
}
