import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseShortVideoLink, extractUrlAndPlatform } from '../electron/services/videoParser';
import { streamGenerateScript } from '../electron/services/llmService';
import { parseKnowledgeBuffer } from '../electron/services/knowledgeParser';
import { buildUserPrompt } from '../src/lib/promptBuilder';

async function withServer(handler: http.RequestListener, run: (baseURL: string) => Promise<void>) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  try { await run('http://127.0.0.1:' + address.port); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test('解析分享链接并拒绝伪造域名', () => {
  assert.equal(extractUrlAndPlatform('分享 https://v.douyin.com/demo/').platform, 'douyin');
  assert.equal(extractUrlAndPlatform('https://xhslink.com/a/demo').platform, 'xiaohongshu');
  assert.equal(extractUrlAndPlatform('https://evil.test/?url=douyin.com').platform, null);
  assert.equal(extractUrlAndPlatform('https://douyin.com.evil.test').platform, null);
});

test('真实模式未配置时明确失败', async () => {
  const parsed = await parseShortVideoLink({ rawInput: 'https://v.douyin.com/demo/', enableMockFallback: false });
  assert.equal(parsed.success, false);
  await assert.rejects(streamGenerateScript({ requestId: 'missing', config: { apiKey: '', baseURL: '', model: '' },
    systemPrompt: '', userPrompt: '', targetDurationSec: 18, userCameraWork: '', enableMockFallback: false }, () => {}), /API Key/);
});

test('解析接口通过 HTTP 合约接收链接并返回真实字段', async () => {
  await withServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-key');
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).url, 'https://v.douyin.com/demo/');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: { transcript: '接口口播', visual_summary: '接口画面', duration: 20 } }));
  }, async (baseURL) => {
    for (const rawInput of ['https://v.douyin.com/demo/']) {
      const result = await parseShortVideoLink({ rawInput, apiEndpoint: baseURL, apiKey: 'test-key', enableMockFallback: false });
      assert.equal(result.success, true); assert.equal(result.isMockData, undefined);
      assert.equal(result.data?.transcript, '接口口播');
      assert.equal(result.data?.durationSec, 20);
    }
  });
});

test('解析接口失败或缺少口播时不伪造成功', async () => {
  for (const payload of [{ success: false, message: '配额不足' }, { data: { title: '只有标题' } }]) {
    await withServer((_req, res) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(payload)); }, async (baseURL) => {
      const result = await parseShortVideoLink({ rawInput: 'https://xhslink.com/demo/', apiEndpoint: baseURL, apiKey: 'test-key', enableMockFallback: false });
      assert.equal(result.success, false); assert.equal(result.isMockData, undefined);
    });
  }
});

test('模型通过 OpenAI 兼容 SSE 接口传递上下文并拼接输出', async () => {
  await withServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    assert.equal(payload.stream, true);
    assert.deepEqual(payload.messages.map((message: { content: string }) => message.content), ['系统规则','上一轮脚本','人工修改后的口播']);
    res.writeHead(200, { 'Content-Type':'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '分镜' } }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '脚本' } }] }) + '\n\n');
    res.end('data: [DONE]\n\n');
  }, async (baseURL) => {
    const chunks: string[] = [];
    const result = await streamGenerateScript({ requestId: 'stream', config: { apiKey:'test-key', baseURL, model:'test-model' },
      systemPrompt:'系统规则', userPrompt:'人工修改后的口播', conversationHistory:[{role:'assistant',content:'上一轮脚本'}],
      enableMockFallback:false, targetDurationSec:18, userCameraWork:'近景' }, (chunk) => chunks.push(chunk));
    assert.equal(result, '分镜脚本'); assert.equal(chunks.join(''), result);
  });
});

test('知识库提取 UTF-8 正文，拒绝空文件及损坏 Word/PDF', async () => {
  const buffer = Buffer.from('企业资料\r\n业务卖点');
  const parsed = await parseKnowledgeBuffer({name:'资料.txt',sizeBytes:buffer.length,buffer});
  assert.equal(parsed.fullContent, '企业资料\n业务卖点');
  for (const name of ['资料.docx','资料.pdf','资料.txt','资料.exe']) {
    await assert.rejects(parseKnowledgeBuffer({name,sizeBytes:0,buffer:Buffer.alloc(0)}));
  }
});

test('自动与手动模式使用各自文案，仅注入启用的知识库', () => {
  const videoInfo = { platform:'douyin' as const, extractedUrl:'https://v.douyin.com/demo/', title:'热点',author:'作者',durationSec:18,
    transcript:'原始口播',visualSummary:'原始画面',suggestedCameraWork:'近景' };
  const base = { videoInfo, targetDurationSec:18,userCameraWork:'近景',companyBusinessProfile:'企业主营业务',
    keywords:[{id:'k',text:'核心产品',category:'brand' as const}], knowledgeDocs: [true,false].map((enabled) => ({
      id:String(enabled),name:enabled?'启用资料':'停用资料',sizeBytes:1,uploadedAt:'',enabled,
      contentSnippet:'',fullContent:enabled?'企业独特卖点':'禁止注入的内容' })) };
  const automatic = buildUserPrompt({...base,editedTranscript:videoInfo.transcript,editedVisualSummary:videoInfo.visualSummary});
  const manual = buildUserPrompt({...base,editedTranscript:'人工修订口播',editedVisualSummary:'人工修订画面'});
  assert.ok(automatic.includes('原始口播')); assert.ok(manual.includes('人工修订口播'));
  assert.ok(!manual.includes('原始口播')); assert.ok(manual.includes('企业独特卖点'));
  assert.ok(!manual.includes('禁止注入的内容')); assert.ok(manual.includes('核心产品'));
  const clearedVisual = buildUserPrompt({...base,editedTranscript:'人工口播',editedVisualSummary:''});
  assert.ok(!clearedVisual.includes('原始画面'));
});


test('真实 PDF 和 DOCX 文件可提取正文', async () => {
  for (const [name,expected] of [['knowledge.pdf','Company knowledge sample'],['knowledge.docx','企业知识库：核心产品与业务卖点。']]) {
    const buffer = await fs.readFile(path.join(__dirname,'fixtures',name));
    const parsed = await parseKnowledgeBuffer({name,sizeBytes:buffer.length,buffer});
    assert.ok(parsed.fullContent.includes(expected));
    assert.equal(parsed.sizeBytes,buffer.length);
  }
});
