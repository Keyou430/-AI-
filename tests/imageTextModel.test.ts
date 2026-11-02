import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertImageRatio, affectedPages, applyImageTextPlan, classifyContent, imageTextImagePrompt, imageTextPlanningPrompt, pageRenderKey } from '../electron/services/imageTextModel';
import type { ImageTextDraft } from '../electron/services/imageTextTypes';
function draftFixture(): ImageTextDraft {
  const d: ImageTextDraft = { id: 'draft-test', createdAt: '2026-10-28', typeOrigin: 'automatic',
    source: { platform: 'xiaohongshu', extractedUrl: 'https://www.xiaohongshu.com/explore/test', title: '收纳', author: '', durationSec: 0,
      transcript: '', publishedText: '真实正文', visualSummary: '', suggestedCameraWork: '', contentKind: 'image-text' },
    title: '收纳', body: '正文', tags: [], style: '原帖实景风格', ratio: '3:4', ratioOrigin: '用户选择', references: [],
    pages: [{ id: 'page-a', text: '封面', visual: '实景', referenceIds: [], assetId: 'old-a' }, { id: 'page-b', text: '方法', visual: '近景', referenceIds: [], assetId: 'old-b' }], notices: [], confirmed: true };
  d.pages.forEach(p => p.renderedKey = pageRenderKey(d, p));
  return d;
}
test('没有口播和单独 OCR 不足以把视频判为图文，显式类型优先', () => {
  const s = draftFixture().source;
  assert.equal(classifyContent(s), 'image-text');
  assert.equal(classifyContent({ ...s, contentKind: undefined }), 'unknown');
  assert.equal(classifyContent({ ...s, contentKind: undefined, transcriptionStatus: 'failed' }), 'video');
  assert.equal(classifyContent({ ...s, contentKind: undefined, durationSec: 18 }), 'video');
});
test('全局优化仅重生成受影响页面，发布文案和排序变化不生图', () => {
  const d = draftFixture();
  d.title = '新标题'; d.body = '新正文'; d.tags = ['新话题']; d.pages.reverse();
  assert.deepEqual(affectedPages(d), []);
  d.pages[0].text = '新方法';
  assert.deepEqual(affectedPages(d).map(p => p.id), ['page-b']);
  d.style = '统一新风格';
  assert.equal(affectedPages(d).length, 2);
});
test('比例与风格参考影响整套，按页素材只影响绑定页', () => {
  const d = draftFixture();
  d.references.push({ id: 'ref-one', kind: 'scene', name: '真实产品', width: 300, height: 400 });
  d.pages[0].referenceIds = ['ref-one'];
  assert.deepEqual(affectedPages(d).map(p => p.id), ['page-a']);
  d.ratio = '1:1'; assert.equal(affectedPages(d).length, 2);
});
test('全局策划保留图片资产和稳定标识，不接受无效模型输出', () => {
  const d = draftFixture();
  const next = applyImageTextPlan(d, JSON.stringify({ ...d, pages: [...d.pages].reverse() }), () => 'new-id');
  assert.deepEqual(affectedPages(next), []);
  assert.equal(next.pages[0].assetId, 'old-b');
  assert.throws(() => applyImageTextPlan(d, '{}', () => 'new-id'), /缺少/);
});
test('文案及生图提示词均注入事实约束，图文不受视频禁文字规则污染', () => {
  const d = draftFixture();
  for (const prompt of [imageTextPlanningPrompt(d, []).system, imageTextImagePrompt(d, d.pages[0])]) {
    assert.match(prompt, /不允许模型自行编造/); assert.match(prompt, /其他品牌/); assert.match(prompt, /省略/);
  }
  assert.match(imageTextImagePrompt(d, d.pages[0]), /整张|整体生成/);
});

test('成品校验整套比例，容忍厂商标准档位取整，拒绝错比例图片', () => {
  assert.doesNotThrow(() => assertImageRatio(2624, 1472, '16:9'));
  assert.throws(() => assertImageRatio(1024, 1024, '3:4'), /比例/);
  assert.throws(() => assertImageRatio(0, 0, '1:1'), /比例/);
});
