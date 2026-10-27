import test from 'node:test';
import assert from 'node:assert/strict';
import { getScriptOutputText } from '../src/lib/scriptOutput';
import type { HistoryRecord, ParsedScriptStructure } from '../src/types';

const script: ParsedScriptStructure = {
  rawText: '完整原文',
  totalShots: 2,
  totalDurationSec: 12,
  shots: [1, 2].map((shotNumber) => ({
    shotNumber,
    timeRange: '0-6秒',
    durationSec: 6,
    actionDivision: '动作' + shotNumber,
    cameraExecution: '运镜' + shotNumber,
    audioContent: '声音' + shotNumber,
    isAmbientOnly: shotNumber === 2,
  })),
  shootingTechniquesSummary: [1, 2].map((shotNumber) => ({
    shotNumber,
    timeRange: '0-6秒',
    cameraStandard: '手法' + shotNumber,
    transitionAdvice: '转场' + shotNumber,
  })),
  voiceoverFullText: '完整口播',
  voiceoverSegments: [
    { shotNumber: 1, timeRange: '0-6秒', content: '分镜声音', isAmbientOnly: false },
  ],
};
const source: HistoryRecord = {
  id: 'record',
  platform: 'douyin',
  sourceUrl: '',
  title: '记录',
  createdAt: '',
  durationSec: 12,
  userCameraWork: '指定运镜',
  originalTranscript: '人工修改稿',
  visualSummary: '',
  rawGeneratedScript: '完整原文',
  parsedStructure: script,
  refinementHistory: [],
  conversationMessages: [],
  sourceContent: {
    platform: 'douyin',
    extractedUrl: '',
    title: '',
    author: '',
    durationSec: 12,
    transcript: '原始口播',
    publishedText: '发布正文',
    visualSummary: '',
    suggestedCameraWork: '',
    extractionDetails: {
      provider: 'linkdigest',
      transcriptSegments: [],
      warnings: ['部分读取提示', '口播已返回，但完整性待核对，请查看提取说明。', '厂商注明有未读取内容，可能涉及评论、画面或其他素材；本结果不是整帖完整副本。'],
      images: [{ ocr: '图片文字', description: '图片描述' }],
      ocrText: ['汇总文字'],
      onScreen: [{ t: null, text: '画面文字' }],
      keyPoints: ['分析要点'],
      credits: 2,
      cached: false,
    },
  },
};

test('拍摄脚本复制全部镜头，拍摄手法不混入动作和声音', () => {
  const storyboard = getScriptOutputText('storyboard', script, '完整原文', '指定运镜');
  for (const fragment of ['动作1', '动作2', '运镜1', '声音2'])
    assert.ok(storyboard.includes(fragment));
  const techniques = getScriptOutputText('techniques', script, '完整原文', '指定运镜');
  for (const fragment of ['指定运镜', '手法1', '手法2', '转场2'])
    assert.ok(techniques.includes(fragment));
  assert.equal(techniques.includes('动作'), false);
  assert.equal(techniques.includes('声音'), false);
});

test('口播、全文、原稿对照分别复制对应内容并保留提取明细', () => {
  assert.equal(
    getScriptOutputText('raw', script, '原始格式\n不改写', '', source),
    '原始格式\n不改写'
  );
  const voiceover = getScriptOutputText('voiceover', script, '完整原文', '', source);
  assert.ok(voiceover.includes('完整口播'));
  assert.ok(voiceover.includes('分镜声音'));
  assert.equal(voiceover.includes('手法'), false);
  const original = getScriptOutputText('source', script, '完整原文', '', source);
  for (const fragment of [
    '人工修改稿',
    '原始口播',
    '发布正文',
    '部分读取提示',
    '图片文字',
    '图片描述',
    '汇总文字',
    '画面文字',
    '分析要点',
  ])
    assert.ok(original.includes(fragment));
  assert.equal(original.includes('动作1'), false);
  assert.equal(original.includes('口播已返回，但完整性待核对'), false);
  assert.equal(original.includes('厂商注明有未读取内容'), false);
  assert.equal(getScriptOutputText('storyboard', null, '未解析的脚本', ''), '未解析的脚本');
});
