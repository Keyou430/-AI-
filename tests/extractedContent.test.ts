import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ParsedVideoInfo } from '../src/types';
import { getEditableSourceText, getExtractedText, getSourceKeywords, isImageTextContent } from '../src/lib/extractedContent';
import { getTranscriptionNotice, isVisibleExtractionNotice } from '../src/lib/extractionNotices';
import { buildUserPrompt } from '../src/lib/promptBuilder';
import { ExtractedContentDetails } from '../src/components/ExtractedContentDetails';

const image: ParsedVideoInfo = {
  platform: 'xiaohongshu', extractedUrl: '', title: '新能源外贸', author: '作者', durationSec: 0,
  transcript: '', publishedText: '图文正文 #新能源[话题]# #外贸[话题]#', transcriptionStatus: 'empty',
  transcriptionMessage: '未返回有效口播，已保留发布文案及可用图文；可将图文素材填入编辑区后再二创。',
  visualSummary: '', suggestedCameraWork: '',
  extractionDetails: { provider: 'linkdigest', transcriptSegments: [], onScreen: [],
    images: [{ ocr: '第一张图片原文', description: '智能描述' }, { ocr: '', description: '' }, { ocr: '第三张图片原文', description: '' }],
    ocrText: ['图片重复汇总'], keyPoints: ['智能分析要点'], tags: ['新能源', '外贸', '出口外贸', '外贸'],
    coverage: { imagesRead: 2, imagesTotal: 3 }, warnings: ['部分图片没有识别结果'] },
};

test('图文使用原始正文与逐图文字，保留图片编号且不混入摘要或重复汇总', () => {
  assert.equal(isImageTextContent(image), true);
  assert.equal(getEditableSourceText(image), image.publishedText + '\n\n第1张图片文字：\n第一张图片原文\n\n第3张图片文字：\n第三张图片原文');
  assert.equal(image.transcript, '');
  const text = getExtractedText({ ...image, extractionDetails: { ...image.extractionDetails!, images: [] } });
  assert.ok(text.includes('图片重复汇总'));
  assert.equal(text.includes('智能分析要点'), false);
});

test('关键词使用真实标签并去重，旧记录从原文话题补齐，不从摘要猜测', () => {
  assert.deepEqual(getSourceKeywords(image), ['新能源', '外贸', '出口外贸']);
  assert.deepEqual(getSourceKeywords({ ...image, extractionDetails: { ...image.extractionDetails!, tags: undefined } }), ['新能源', '外贸']);
  assert.deepEqual(getSourceKeywords({ ...image, publishedText: '没有话题的正文', extractionDetails: { ...image.extractionDetails!, tags: undefined } }), []);
});

test('图文不再提示缺少口播，但缺图警告与视频转写失败仍保留', () => {
  assert.equal(getTranscriptionNotice(image), undefined);
  assert.equal(isVisibleExtractionNotice(image.extractionDetails!.warnings[0]), true);
  const video = { ...image, durationSec: 18, transcriptionStatus: 'failed' as const, transcriptionMessage: '视频口播提取失败，请重试' };
  assert.equal(isImageTextContent(video), false);
  assert.equal(getEditableSourceText(video), '');
  assert.equal(getTranscriptionNotice(video), video.transcriptionMessage);
  const voicedVideo = { ...image, transcript: '视频真实口播', durationSec: 18 };
  assert.equal(isImageTextContent(voicedVideo), false);
  assert.equal(getEditableSourceText(voicedVideo), voicedVideo.transcript);
});

test('关键词直接展示，图文覆盖信息不再显示未知口播秒数', () => {
  const html = renderToStaticMarkup(React.createElement(ExtractedContentDetails, { content: image, onUseText: () => {} }));
  assert.ok(html.includes('data-testid="source-keywords"'));
  assert.ok(html.includes('出口外贸'));
  assert.ok(html.indexOf('素材关键词') < html.indexOf('<details'));
  assert.ok(html.includes('已读取图片'));
  assert.ok(html.includes('部分图片没有识别结果'));
  assert.equal(html.includes('已转写'), false);
  assert.equal(html.includes('未返回有效口播'), false);
});

test('图文二创使用正文、图片原文与原帖关键词，人工修改优先', () => {
  const input = { videoInfo: image, editedTranscript: '', editedVisualSummary: '', targetDurationSec: 30,
    userCameraWork: '', companyBusinessProfile: '企业业务', keywords: [], knowledgeDocs: [] };
  const prompt = buildUserPrompt(input);
  for (const text of ['图文素材文案', '第一张图片原文', '第三张图片原文', '原素材关键词', '出口外贸']) assert.ok(prompt.includes(text));
  assert.equal(prompt.includes('智能分析要点'), false);
  const edited = buildUserPrompt({ ...input, editedTranscript: '核对后的人工作品文案' });
  assert.ok(edited.includes('图文素材文案（含人工修订）：核对后的人工作品文案'));
  assert.equal(edited.includes('第一张图片原文'), false);
});
