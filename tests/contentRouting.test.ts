import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageTextFixture } from './helpers/imageTextFixture';

const memory = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => memory.get(k) || null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) } });
Object.assign(globalThis, { window: { localStorage: globalThis.localStorage } });
const { useAppStore } = require('../src/store/useAppStore') as typeof import('../src/store/useAppStore');
const { useImageTextStore } = require('../src/store/useImageTextStore') as typeof import('../src/store/useImageTextStore');
const { extractAndRoute, routeExtractedContent } = require('../src/services/contentExtraction') as typeof import('../src/services/contentExtraction');
function reset() {
  useAppStore.setState({ ...useAppStore.getInitialState() }); useImageTextStore.setState({ ...useImageTextStore.getInitialState() });
}
test('一次提取图文自动跳转并自动策划，不改已有视频工作台、不提前生图', async () => {
  reset(); const source = imageTextFixture().source; let parsed = 0; let plans = 0; let images = 0;
  Object.assign(globalThis, { window: { electronAPI: {
    parseVideo: async () => { parsed++; return { success: true, data: source }; },
    planImageText: async ({ draft }: any) => { plans++; return { success: true, data: { ...draft, pages: imageTextFixture().pages, style: '实景', body: '二创正文' } }; },
    generateImageText: async () => { images++; return { success: true }; }, saveImageTextHistory: async () => ({ success: true }),
  } } });
  useAppStore.getState().setParsedVideo({ ...source, contentKind: 'video', durationSec: 18, transcript: '已有未保存视频' });
  await extractAndRoute(source.extractedUrl);
  const deadline = Date.now() + 3000;
  while (useImageTextStore.getState().taskId) { if (Date.now() > deadline) throw new Error('图文策划未完成'); await new Promise<void>(resolve => setImmediate(resolve)); }
  assert.equal(parsed, 1); assert.equal(plans, 1); assert.equal(images, 0);
  assert.equal(useAppStore.getState().activeNav, 'image-text'); assert.equal(useAppStore.getState().editedTranscript, '已有未保存视频');
  assert.equal(useImageTextStore.getState().draft!.source.publishedText, source.publishedText);
});
test('类型不明时保留素材供人工指定，选择后不重复提取；视频自动回原工作台', () => {
  reset(); const source = { ...imageTextFixture().source, contentKind: 'unknown' as const };
  routeExtractedContent(source); assert.deepEqual(useImageTextStore.getState().pendingSource, source);
  routeExtractedContent(source, 'video'); assert.equal(useImageTextStore.getState().pendingSource, null);
  assert.equal(useAppStore.getState().activeNav, 'workbench'); assert.equal(useAppStore.getState().parsedVideo!.contentKind, 'video');
  useAppStore.setState({ activeNav: 'image-text' });
  routeExtractedContent({ ...source, contentKind: 'video', durationSec: 18 }); assert.equal(useAppStore.getState().activeNav, 'workbench');
});

test('视频提取不自动填入建议运镜，保留手动输入且清空后不再补填', () => {
  reset();
  const source = { ...imageTextFixture().source, contentKind: 'video' as const, durationSec: 18,
    transcript: '原视频口播', suggestedCameraWork: '前3秒黄金钩子破题吸引眼球，中段对比打消疑虑，尾段号召互动转化。' };
  assert.equal(useAppStore.getState().userCameraWork, '');
  routeExtractedContent(source);
  assert.equal(useAppStore.getState().userCameraWork, '');
  assert.equal(useAppStore.getState().parsedVideo?.suggestedCameraWork, source.suggestedCameraWork);
  useAppStore.getState().setUserCameraWork('近景俯拍、特写推进');
  routeExtractedContent({ ...source, suggestedCameraWork: '环绕镜头' });
  assert.equal(useAppStore.getState().userCameraWork, '近景俯拍、特写推进');
  useAppStore.getState().setUserCameraWork('');
  routeExtractedContent(source);
  assert.equal(useAppStore.getState().userCameraWork, '');
});
