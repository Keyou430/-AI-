import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { parseGeneratedScript, runScriptComplianceChecks } from '../src/lib/scriptParser';
import { getScriptOutputText } from '../src/lib/scriptOutput';
import { buildSystemPrompt } from '../src/lib/promptBuilder';

const chineseScript = fs.readFileSync(path.join(__dirname, 'fixtures/chineseStoryboard.txt'), 'utf8');
function shot(number: string, time: string, body = '▪️人员动作分工：展示产品\n▪️运镜与拍摄执行标准：近景平移\n▪️声音内容：口播：检查细节再出发。') {
  return '【镜头' + number + ' | ' + time + '】\n' + body;
}
test('中文数字九镜头、152 秒完整解析，保留多行字段和原始全文', () => {
  const parsed = parseGeneratedScript(chineseScript);
  assert.equal(parsed.totalShots, 9); assert.equal(parsed.totalDurationSec, 152);
  assert.deepEqual(parsed.shots.map(item => item.shotNumber), [1,2,3,4,5,6,7,8,9]);
  assert.deepEqual(parsed.shots.map(item => item.durationSec), [10,18,18,18,18,18,18,18,16]);
  assert.equal(parsed.rawText, chineseScript.trim());
  assert.equal(parsed.shots[0].timeRange, '零至十秒');
  assert.equal(parsed.shots[0].actionDivision, '销售顾问走向驾驶室，摄影师后退跟拍。\n保持顾问肩部与车头同框。');
  assert.equal(parsed.shots[0].cameraExecution, '近景俯拍、特写推进、中景平视跟随。\n主光使用展厅顶灯，侧面补光。');
  assert.equal(parsed.shots[0].audioContent, '口播：今天讲三个坑，准备入行的一定听完。\n先把挑单和搬运说明白。');
  assert.equal(parsed.shootingTechniquesSummary.length, 9); assert.equal(parsed.voiceoverSegments.length, 9);
  assert.equal(parsed.shots[7].isAmbientOnly, true);
  assert.ok(!parsed.voiceoverFullText.includes('展厅背景声')); assert.ok(!parsed.voiceoverFullText.includes('口播：'));
  assert.ok(parsed.voiceoverFullText.includes('把这些细节做好，再开始你的第一单。'));
  for (const id of ['duration-match','shot-order','three-fields','voice-duration']) {
    assert.equal(runScriptComplianceChecks(parsed, 152, '').find(item => item.id === id)?.passed, true, id);
  }
});
test('原阿拉伯数字格式、全角分隔符、两种时间单位位置和混合编号保持兼容', () => {
  for (const [number, expected] of [['1',1],['十',10],['十一',11],['二十',20],['二十一',21],['两百零二',202],['一千零一',1001],['一〇二',102]] as const) {
    const parsed = parseGeneratedScript(shot(number, '10秒至28秒'));
    assert.equal(parsed.shots[0].shotNumber, expected); assert.equal(parsed.shots[0].durationSec, 18);
  }
  for (const separator of ['-','~','～','—','–','至','到']) {
    assert.equal(parseGeneratedScript(shot('1', '0' + separator + '10秒')).shots[0].durationSec, 10);
  }
  const mixed = parseGeneratedScript('【分镜脚本总览】共2个镜头，总时长28秒\n' + shot('1', '0-10秒') + '\n' + shot('二', '十至二十八秒').replace(' | ', '｜'));
  assert.equal(mixed.totalDurationSec, 28); assert.equal(mixed.shots.length, 2);
  assert.equal(mixed.shots[1].audioContent, '口播：检查细节再出发。');
});
test('字段不依赖特殊项目符号或变体选择符，不截断换行和同一行字段', () => {
  for (const prefix of ['▪️','▪','•','- ','* ','']) {
    const parsed = parseGeneratedScript(shot('一', '零至十秒', [
      prefix + '人员动作分工：顾问展示产品', '摄影师后退跟拍',
      prefix + '运镜与拍摄执行标准：近景平移', '补充灯光要求',
      prefix + '声音内容：口播：第一行', '第二行',
    ].join('\r\n')));
    assert.equal(parsed.shots[0].actionDivision, '顾问展示产品\r\n摄影师后退跟拍');
    assert.equal(parsed.shots[0].cameraExecution, '近景平移\r\n补充灯光要求');
    assert.equal(parsed.shots[0].audioContent, '口播：第一行\r\n第二行');
  }
  const inline = parseGeneratedScript(shot('1', '0-10秒', '▪️人员动作分工：展示 ▪️运镜与拍摄执行标准：近景 ▪️声音内容：口播：介绍'));
  assert.equal(inline.shots[0].actionDivision, '展示'); assert.equal(inline.shots[0].cameraExecution, '近景'); assert.equal(inline.shots[0].audioContent, '口播：介绍');
});
test('空字段不吞掉下一项，解析失败不误称全是环境音', () => {
  const incomplete = parseGeneratedScript(shot('1', '0-10秒', '▪人员动作分工：\n▪运镜与拍摄执行标准：近景\n▪声音内容：'));
  assert.equal(incomplete.shots[0].actionDivision, ''); assert.equal(incomplete.shots[0].cameraExecution, '近景');
  assert.ok(!incomplete.voiceoverFullText.includes('均为环境音'));
  assert.ok(!parseGeneratedScript('尚未完成的分镜正文').voiceoverFullText.includes('均为环境音'));
  assert.ok(parseGeneratedScript(shot('一', '零至十秒', '声音内容：仅环境音：风声')).voiceoverFullText.includes('均为环境音'));
});
test('流式接收中文镜头不提前混合前后镜内容，完成后恢复全部镜头', () => {
  const first = shot('一', '零至十秒'); const second = shot('二', '十至二十八秒');
  const partial = parseGeneratedScript(first + '\n' + second.split('声音内容')[0]);
  assert.equal(partial.shots.length, 2); assert.equal(partial.shots[0].audioContent, '口播：检查细节再出发。');
  assert.equal(partial.shots[1].audioContent, '');
  assert.equal(parseGeneratedScript(first + '\n' + second).voiceoverSegments.length, 2);
});
test('中文分镜的拍摄手法和口播复制分别取对应内容，全文保持原样', () => {
  const parsed = parseGeneratedScript(chineseScript);
  const techniques = getScriptOutputText('techniques', parsed, chineseScript, '');
  assert.ok(techniques.includes('近景俯拍、特写推进、中景平视跟随。'));
  assert.ok(!techniques.includes('今天讲三个坑'));
  const voiceover = getScriptOutputText('voiceover', parsed, chineseScript, '');
  assert.ok(voiceover.includes('今天讲三个坑')); assert.ok(!voiceover.includes('主光使用展厅顶灯'));
  assert.equal(getScriptOutputText('raw', parsed, chineseScript, ''), chineseScript);
});
test('生成提示词明确允许镜头数字使用阿拉伯数字，避免纯中文要求冲突', () => {
  assert.ok(buildSystemPrompt().includes('镜头序号、镜头数量和时间统一使用阿拉伯数字'));
});
