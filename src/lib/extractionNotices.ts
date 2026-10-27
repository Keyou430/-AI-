import type { ParsedVideoInfo } from '../types';

const hiddenNotices = new Set([
  '口播已返回，但完整性待核对，请查看提取说明。',
  '厂商注明有未读取内容，可能涉及评论、画面或其他素材；本结果不是整帖完整副本。',
]);

/** 仅过滤展示文案，保留提取状态及原始历史数据。 */
export function isVisibleExtractionNotice(message: string): boolean {
  return Boolean(message.trim()) && !hiddenNotices.has(message.trim());
}

export function getTranscriptionNotice(content: ParsedVideoInfo | null): string | undefined {
  if (!content?.transcriptionStatus || content.transcriptionStatus === 'succeeded') return;
  const message = content.transcriptionMessage || '未获得完整口播，请核对并补充后生成。';
  return isVisibleExtractionNotice(message) ? message : undefined;
}
