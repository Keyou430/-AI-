const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async ({ window, call, waitFor, manualRecord }) => {
  const raw = fs.readFileSync(path.join(__dirname, '../tests/fixtures/chineseStoryboard.txt'), 'utf8');
  const record = { ...manualRecord, id: 'smoke-chinese-storyboard', title: '中文数字九镜头验收',
    platform: 'xiaohongshu', durationSec: 152, originalTranscript: '中文九镜头验收口播',
    rawGeneratedScript: raw, refinementHistory: [], conversationMessages: [],
    sourceContent: { ...manualRecord.sourceContent, platform: 'xiaohongshu', durationSec: 152 },
    parsedStructure: { rawText: raw, totalShots: 0, totalDurationSec: 0, shots: [],
      shootingTechniquesSummary: [], voiceoverFullText: '（当前分镜脚本均为环境音镜头，未包含人声口播）', voiceoverSegments: [] } };
  const evaluate = (fn, ...args) => window.webContents.executeJavaScript('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const content = () => evaluate(() => document.querySelector('[data-testid=script-result-scroll]').innerText);
  const checks = [];
  const openHistory = async target => {
    await evaluate(() => document.querySelector('nav button[aria-label=历史记录]').click());
    await waitFor(window, 'Array.from(document.querySelectorAll("button")).some(el => el.textContent.trim() === "刷新" && !el.disabled)');
    await waitFor(window, 'Boolean(document.querySelector("[data-record-id=' + target.id + ']"))');
    await evaluate(id => document.querySelector('[data-record-id="' + id + '"]').click(), target.id);
    await waitFor(window, 'Array.from(document.querySelectorAll("h2")).some(el => el.textContent === ' + JSON.stringify(target.title) + ')');
  };
  const tab = async name => {
    await evaluate(label => Array.from(document.querySelectorAll('[aria-label=脚本视图] [role=tab]')).find(el => el.textContent === label).click(), name);
    await waitFor(window, 'document.querySelector("[aria-label=脚本视图] [aria-selected=true]")?.textContent === ' + JSON.stringify(name));
  };
  const click = label => evaluate(name => document.querySelector('[aria-label="' + name + '"]').click(), label);
  const choose = async page => {
    await evaluate(value => {
      const select = document.querySelector('select[aria-label=选择镜头]');
      select.value = String(value); select.dispatchEvent(new Event('change', { bubbles: true }));
    }, page);
    await waitFor(window, 'document.querySelector("select[aria-label=选择镜头]")?.value === "' + page + '"');
  };
  const copy = async (label, contains, excludes) => {
    await evaluate(() => { window.__scriptParsingCopied = null; });
    await click(label);
    await waitFor(window, 'typeof window.__scriptParsingCopied === "string"');
    const copied = await evaluate(() => window.__scriptParsingCopied);
    for (const text of contains) assert.ok(copied.includes(text), '复制缺少：' + text);
    for (const text of excludes) assert.ok(!copied.includes(text), '复制混入：' + text);
    return copied;
  };
  const verify = async (context, copyLabel) => {
    await tab('拍摄脚本');
    await waitFor(window, 'document.querySelector("select[aria-label=选择镜头]")?.options.length === 9');
    await choose(0);
    assert.equal(await evaluate(() => document.querySelector('[aria-label=上一个镜头]').disabled), true);
    assert.ok((await content()).includes('保持顾问肩部与车头同框。'));
    assert.equal(await evaluate(() => document.querySelectorAll('[role=tabpanel] article').length), 1);
    await click('下一个镜头');
    await waitFor(window, 'document.querySelector("select[aria-label=选择镜头]").value === "1"');
    assert.ok((await content()).includes('顾问打开车门，侧身指向车内座椅。'));
    assert.ok(!(await content()).includes('保持顾问肩部与车头同框。'));
    await click('上一个镜头');
    await waitFor(window, 'document.querySelector("select[aria-label=选择镜头]").value === "0"');
    await choose(8);
    assert.equal(await evaluate(() => document.querySelector('[aria-label=下一个镜头]').disabled), true);
    assert.ok((await content()).includes('顾问回到画面中央，摄影师缓慢拉远。'));
    checks.push(context + '：九镜头翻页、下拉、首尾禁用');
    await tab('拍摄手法');
    assert.ok((await content()).includes('中景拉远，正面平视。'));
    await choose(0);
    assert.ok((await content()).includes('主光使用展厅顶灯，侧面补光。'));
    await click('下一个镜头');
    await waitFor(window, 'document.querySelector("select[aria-label=选择镜头]").value === "1"');
    assert.ok((await content()).includes('特写推进，侧面平视。'));
    await copy(copyLabel('拍摄手法'), ['主光使用展厅顶灯，侧面补光。', '中景拉远，正面平视。'], ['今天讲三个坑']);
    checks.push(context + '：手法随镜头切换、复制完整手法');
    await tab('口播稿');
    const voice = await content();
    assert.ok(voice.includes('今天讲三个坑')); assert.ok(voice.includes('先把挑单和搬运说明白。'));
    assert.ok(voice.includes('把这些细节做好，再开始你的第一单。'));
    assert.ok(!voice.includes('均为环境音'));
    const copiedVoice = await copy(copyLabel('口播稿'), ['今天讲三个坑', '先把挑单和搬运说明白。', '把这些细节做好，再开始你的第一单。', '分镜声音明细', '关门声与展厅背景声。'], ['主光使用展厅顶灯']);
    assert.ok(!copiedVoice.split('分镜声音明细')[0].includes('关门声与展厅背景声。'));
    checks.push(context + '：完整口播、换行保留、分镜声音明细');
    await tab('全文');
    assert.equal(await evaluate(() => document.querySelector('[role=tabpanel] pre').textContent), raw);
    assert.equal(await copy(copyLabel('全文'), [raw], []), raw);
    checks.push(context + '：全文与复制保留原文');
  };
  assert.equal((await call('saveHistoryToDB', record)).success, true);
  await evaluate(() => {
    window.__scriptParsingOriginalClipboard = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async text => { window.__scriptParsingCopied = text; };
  });
  try {
    await openHistory(record);
    await verify('旧历史空缓存恢复', () => '复制当前标签内容');
    await evaluate(() => Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === '重新编辑').click());
    await waitFor(window, 'document.querySelector("[data-testid=editable-transcript]")?.value === "中文九镜头验收口播"');
    await verify('工作台重新编辑', name => '复制' + name);
    const stored = (await call('listHistoryFromDB')).records.find(item => item.id === record.id);
    assert.equal(stored.parsedStructure.shots.length, 0);
    assert.equal(stored.rawGeneratedScript, raw);
    checks.push('只读恢复：数据库原文和旧缓存未改写');
    await tab('拍摄脚本'); await choose(0);
    const evidenceDirectory = path.join(__dirname, '../release/script-parsing-smoke');
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    fs.writeFileSync(path.join(evidenceDirectory, 'result.json'), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), checks }, null, 2));
    console.log('中文分镜桌面验收通过：' + checks.join('；'));
  } finally {
    await evaluate(() => {
      navigator.clipboard.writeText = window.__scriptParsingOriginalClipboard;
      delete window.__scriptParsingOriginalClipboard; delete window.__scriptParsingCopied;
    });
    assert.equal((await call('deleteHistoryFromDB', record.id)).success, true);
    await openHistory(manualRecord);
    await evaluate(() => Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === '重新编辑').click());
    await waitFor(window, 'document.querySelector("[data-testid=editable-transcript]")?.value === ' + JSON.stringify(manualRecord.originalTranscript));
  }
};
