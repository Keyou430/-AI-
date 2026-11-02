import type { ImageTextDraft } from '../../electron/services/imageTextTypes';
import { pageRenderKey } from '../../electron/services/imageTextModel';
export const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lV8AAAAASUVORK5CYII=', 'base64');
export function imageTextFixture(): ImageTextDraft {
  const draft: ImageTextDraft = { id: 'fixture-draft', createdAt: '2026-10-28T12:00:00.000Z', typeOrigin: 'automatic',
    source: { platform: 'xiaohongshu', extractedUrl: 'https://www.xiaohongshu.com/explore/fixture', title: '桌面收纳', author: '作者', durationSec: 0,
      transcript: '', publishedText: '原帖主题', visualSummary: '', suggestedCameraWork: '', contentKind: 'image-text' },
    title: '桌面收纳', body: '发布正文', tags: ['收纳'], style: '自然光实景', ratio: '1:1', ratioOrigin: '原帖参考图', references: [],
    pages: [{ id: 'page-one', text: '封面文字', visual: '桌面全景', referenceIds: [], assetId: 'old-one' },
      { id: 'page-two', text: '收纳方法', visual: '桌面近景', referenceIds: [], assetId: 'old-two' }], notices: [], confirmed: true };
  draft.pages.forEach(page => page.renderedKey = pageRenderKey(draft, page));
  return draft;
}
