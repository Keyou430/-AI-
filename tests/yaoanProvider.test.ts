import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseShortVideoLink } from '../electron/services/videoParser';
import { parseYaoanVideoResponse } from '../electron/services/yaoanVideoProvider';

// 本文件只使用协议样本；不访问真实厂商、不产生商业调用。
const fixture = { code: 0, success: true, data: { desc: '完整发布文案\n第二行', nickname: '作者', duration: 18000,
  audio_text: '完整视频口播', is_audio_success: true } };

test('聚合服务自动区分平台端点和密钥参数，只发送一次提取请求', async () => {
  const original = globalThis.fetch;
  const requests: {url: URL; init?: RequestInit}[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return new Response(JSON.stringify(fixture), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    for (const [link, endpoint, keyName] of [
      ['https://v.douyin.com/demo/', '/api/plugins/douyin/dy_video_to_text', 'api_key'],
      ['https://xhslink.cn/demo/', '/api/plugins/xiaohongshu/video_to_text', 'apiKey'],
    ]) {
      const count = requests.length;
      const result = await parseShortVideoLink({ rawInput: link, apiProvider: 'yaoan', apiKey: 'fixture-secret', enableMockFallback: false });
      assert.equal(result.success, true);
      assert.equal(requests.length, count + 1);
      const request = requests.at(-1)!;
      assert.equal(request.url.origin, 'https://cyanlis.cn'); assert.equal(request.url.pathname, endpoint);
      assert.equal(request.url.searchParams.get(keyName), 'fixture-secret');
      assert.equal(request.url.searchParams.get(keyName === 'api_key' ? 'apiKey' : 'api_key'), null);
      assert.equal(request.url.searchParams.get('use_own_key'), 'false'); assert.equal(request.url.searchParams.get('url'), link);
      assert.equal(request.init?.method, 'GET'); assert.equal(request.init?.body, undefined);
    }
  } finally { globalThis.fetch = original; }
});

test('发布文案与口播分开保留，抖音毫秒转秒，小红书未知时长不猜测', () => {
  const result = parseYaoanVideoResponse(fixture, 'douyin', 'https://v.douyin.com/demo/');
  assert.equal(result.data?.publishedText, fixture.data.desc); assert.equal(result.data?.transcript, fixture.data.audio_text);
  assert.equal(result.data?.durationSec, 18); assert.equal(result.data?.transcriptionStatus, 'succeeded');
  assert.equal(result.data?.visualSummary, ''); assert.equal(result.data?.suggestedCameraWork, '');
  const xhs = parseYaoanVideoResponse({ ...fixture, data: { ...fixture.data, title: '笔记标题', user: {nickname:'笔记作者'} } }, 'xiaohongshu', 'https://xhslink.cn/demo/');
  assert.equal(xhs.data?.title, '笔记标题'); assert.equal(xhs.data?.author, '笔记作者'); assert.equal(xhs.data?.durationSec, 0);
});

test('转写失败、空口播和图文笔记明确提示并保留已获取发布文案', () => {
  for (const [patch, status] of [
    [{is_audio_success:false}, 'failed'], [{audio_text:'  '}, 'empty'], [{type:'normal'}, 'not_video'],
  ] as const) {
    const result = parseYaoanVideoResponse({ ...fixture, data: { ...fixture.data, ...patch } }, 'xiaohongshu', 'https://xhslink.cn/demo/');
    assert.equal(result.success, false); assert.equal(result.errorCode, 'TRANSCRIPTION_FAILED');
    assert.equal(result.data?.transcriptionStatus, status); assert.equal(result.data?.publishedText, fixture.data.desc);
    assert.ok(result.errorMessage);
  }
  for (const payload of [null, {success:false,code:0,data:fixture.data}, {success:true,code:500,msg:'fixture-secret'}]) {
    const result = parseYaoanVideoResponse(payload, 'douyin', 'https://v.douyin.com/demo/');
    assert.equal(result.success, false); assert.equal(result.data, undefined); assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
  }
});

test('鉴权、余额和限流失败不自动重试、不回显供应商错误正文或密钥', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401,403,429,500]) {
      let count = 0;
      globalThis.fetch = async () => { count++; return new Response('fixture-secret', {status}); };
      const result = await parseShortVideoLink({rawInput:'https://v.douyin.com/demo/', apiProvider:'yaoan', apiKey:'fixture-secret', enableMockFallback:false});
      assert.equal(result.success, false); assert.equal(count, 1); assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
      assert.equal(result.isMockData, undefined);
      assert.match(result.errorMessage!, status === 401 ? /接口密钥/ : status === 403 ? /余额/ : status === 429 ? /限流/ : /500/);
    }
  } finally { globalThis.fetch = original; }
});
