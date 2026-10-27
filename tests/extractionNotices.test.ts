import test from 'node:test';
import assert from 'node:assert/strict';
import { getTranscriptionNotice, isVisibleExtractionNotice } from '../src/lib/extractionNotices';
import type { ParsedVideoInfo } from '../src/types';

const original: ParsedVideoInfo = {
  platform: 'douyin', extractedUrl: '', title: '', author: '', durationSec: 18,
  transcript: '返回口播', visualSummary: '', suggestedCameraWork: '',
  transcriptionStatus: 'partial',
  transcriptionMessage: '口播已返回，但完整性待核对，请查看提取说明。',
};

test('隐藏指定提取提示，不触发替代文案或改变原始状态', () => {
  assert.equal(getTranscriptionNotice(original), undefined);
  assert.equal(original.transcriptionStatus, 'partial');
  assert.equal(isVisibleExtractionNotice('厂商注明有未读取内容，可能涉及评论、画面或其他素材；本结果不是整帖完整副本。'), false);
  assert.equal(isVisibleExtractionNotice('  ' + original.transcriptionMessage + '  '), false);
  assert.equal(isVisibleExtractionNotice('部分图片没有识别结果'), true);
  assert.equal(getTranscriptionNotice({ ...original, transcriptionStatus: 'empty', transcriptionMessage: '未返回有效口播' }), '未返回有效口播');
  assert.equal(getTranscriptionNotice({ ...original, transcriptionMessage: undefined }), '未获得完整口播，请核对并补充后生成。');
});
