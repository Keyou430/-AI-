import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalProviderService } from '../electron/services/localProviderService';
import { IMAGE_PRESETS } from '../electron/services/providerConfig';
import { generateImageTextImage, requestProviderImage } from '../electron/services/imageGenerationService';
import { SUB2API_SIZES } from '../electron/services/sub2apiImageService';
import { ImageTextAssets, MAX_IMAGE_BYTES } from '../electron/services/imageTextAssets';
import { imageTextImagePrompt } from '../electron/services/imageTextModel';
import { imageTextFixture, pngBytes } from './helpers/imageTextFixture';

const config = { ...IMAGE_PRESETS.sub2api, imageApiKey: 'fixture-sub2api-key' };
const input = { prompt: '自然光，保留主体，准确呈现中文标题', ratio: '1:1' as const, references: [] as string[] };
const resultUrl = 'https://assets.example/image.png?signature=fixture';
const taskUrl = 'https://www.sevnx.lol/v1/images/tasks/imgtask_fixture';
const processing = { id: 'imgtask_fixture', task_id: 'imgtask_fixture', status: 'processing', poll_url: '/v1/images/tasks/imgtask_fixture' };
const completed = { ...processing, status: 'completed', result: { data: [{ url: resultUrl }], size: '1195x1316', quality: 'low', output_format: 'png' } };
const queued = (task: unknown = processing, headers: Record<string, string> = { 'Retry-After': '0' }) => Response.json(task, { status: 202, headers });
const polled = (task: unknown = completed, headers: Record<string, string> = { 'Retry-After': '0' }) => Response.json(task, { headers });
const signal = () => new AbortController().signal;
type Call = { url: string; init?: RequestInit };
function sequence(responses: Response[], calls: Call[] = []): typeof fetch {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    const response = responses.shift();
    assert.ok(response, '不应自动重提任务、继续终态轮询或访问真实服务');
    return response;
  };
}
const storage = { isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(Buffer.from(value).toString('base64')),
  decryptString: (value: Buffer) => Buffer.from(value.toString(), 'base64').toString() };

test('S01 Sub2API 预设独立加密保存、重读，同厂商保留密钥，跨厂商不能误用密钥', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sub2api-settings-'));
  try {
    const service = new LocalProviderService(dir, storage);
    const base = { llmBaseUrl: 'https://text.example/v1', llmModel: 'text', llmApiKey: 'text-secret',
      videoParserEndpoint: 'https://extract.example', videoParserApiKey: 'extract-secret', ...IMAGE_PRESETS.agnes, imageApiKey: 'agnes-secret' };
    service.save(base);
    assert.throws(() => service.saveModule('image', { ...base, ...config, imageApiKey: '' }), /更换图片生成服务商/);
    const saved = service.saveModule('image', { ...base, ...config });
    assert.equal(saved.imageProtocol, 'sub2api'); assert.equal(saved.imageKeyConfigured, true);
    assert.equal(JSON.stringify(saved).includes(config.imageApiKey), false);
    assert.equal((await fs.readFile(path.join(dir, 'providers.encrypted'))).includes(Buffer.from(config.imageApiKey)), false);
    const restarted = new LocalProviderService(dir, storage);
    assert.equal(restarted.read().imageApiKey, config.imageApiKey);
    assert.equal(restarted.read().llmApiKey, 'text-secret'); assert.equal(restarted.read().videoParserApiKey, 'extract-secret');
    restarted.saveModule('image', { ...base, ...config, imageApiKey: '', imageModel: 'custom-image-model' });
    assert.equal(restarted.read().imageApiKey, config.imageApiKey);
    assert.equal(restarted.read().imageModel, 'custom-image-model');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('S02 只提交一次，processing 继续查询，completed 下载跨域图片且不携带密钥', async () => {
  const calls: Call[] = [];
  const bytes = await requestProviderImage(config, input, signal(), sequence([
    queued(), polled(processing), polled(), new Response(pngBytes),
  ], calls));
  assert.deepEqual(bytes, pngBytes); assert.equal(calls.length, 4);
  assert.equal(calls[0].url, config.imageEndpoint); assert.equal(calls[0].init?.method, 'POST');
  const body = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(body, { model: 'gpt-image-2', prompt: input.prompt, n: 1, size: '1024x1024', quality: 'medium', async: true });
  assert.equal(body.stream, undefined); assert.equal(new Headers(calls[0].init?.headers).get('Content-Type'), 'application/json');
  for (const call of calls.slice(0, 3)) {
    assert.equal(new Headers(call.init?.headers).get('Authorization'), 'Bearer ' + config.imageApiKey);
    assert.equal(call.init?.redirect, 'error'); assert.equal(call.init?.signal, calls[0].init?.signal);
  }
  for (const call of calls.slice(1, 3)) { assert.equal(call.url, taskUrl); assert.equal(call.init?.method, 'GET'); }
  assert.equal(calls[3].url, resultUrl); assert.equal(calls[3].init?.redirect, 'error');
  assert.equal(new Headers(calls[3].init?.headers).has('Authorization'), false);
});
test('S03 Retry-After 约束轮询间隔，缺失字段使用 3 秒默认值', async () => {
  const started = Date.now(); const calls: Call[] = [];
  await requestProviderImage(config, input, signal(), sequence([queued(processing, {}), polled(), new Response(pngBytes)], calls));
  assert.ok(Date.now() - started >= 2900); assert.equal(calls.length, 3);
});
test('S04 有参考图自动改用 multipart edits，同时提交完整本页文字、风格和上一版图片', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sub2api-edit-'));
  try {
    const assets = new ImageTextAssets(dir); const draft = imageTextFixture();
    const styleId = await assets.save(pngBytes); const sceneId = await assets.save(pngBytes); const oldId = await assets.save(pngBytes);
    draft.references = [{ id: styleId, kind: 'style', name: 'style.png', width: 1, height: 1 }, { id: sceneId, kind: 'scene', name: 'scene.png', width: 1, height: 1 }];
    draft.pages[0].assetId = oldId; draft.pages[0].referenceIds = [sceneId, styleId];
    const before = structuredClone(draft); const calls: Call[] = [];
    const output = await generateImageTextImage({ draft, pageId: 'page-one', usePreviousImage: true }, config, assets, signal(),
      sequence([queued(), polled(), new Response(pngBytes)], calls));
    assert.equal(calls[0].url, 'https://www.sevnx.lol/v1/images/edits');
    assert.equal(new Headers(calls[0].init?.headers).has('Content-Type'), false);
    const form = calls[0].init?.body as FormData;
    assert.ok(form instanceof FormData); assert.equal(form.get('prompt'), imageTextImagePrompt(draft, draft.pages[0]));
    assert.match(String(form.get('prompt')), /封面文字/); assert.equal(form.get('async'), 'true');
    assert.equal(form.get('model'), 'gpt-image-2'); assert.equal(form.get('n'), '1'); assert.equal(form.has('stream'), false);
    const files = form.getAll('image[]') as File[];
    assert.equal(files.length, 3, '重复绑定的参考素材应去重');
    for (const file of files) { assert.equal(file.type, 'image/png'); assert.deepEqual(Buffer.from(await file.arrayBuffer()), pngBytes); }
    assert.notEqual(output.assetId, oldId); assert.deepEqual(await assets.read(output.assetId), pngBytes);
    assert.deepEqual(await assets.read(oldId), pngBytes); assert.deepEqual(draft, before);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('S05 自定义 HTTPS 地址、代理路径及 async 别名按是否附图切换操作', async () => {
  for (const [endpoint, references, expected] of [
    ['https://proxy.example/prefix/v1/images/generations/async', ['data:image/png;base64,' + pngBytes.toString('base64')], 'https://proxy.example/prefix/v1/images/edits/async'],
    ['https://proxy.example/prefix/v1/images/edits/', [], 'https://proxy.example/prefix/v1/images/generations'],
  ] as const) {
    const calls: Call[] = [];
    await requestProviderImage({ ...config, imageEndpoint: endpoint }, { ...input, references: [...references] }, signal(), sequence([
      queued({ ...processing, poll_url: '/prefix/v1/images/tasks/imgtask_fixture' }), polled(), new Response(pngBytes),
    ], calls));
    assert.equal(calls[0].url, expected); assert.equal(calls[1].url, 'https://proxy.example/prefix/v1/images/tasks/imgtask_fixture');
  }
});
test('S06 取消轮询等待后立即结束，不再查询或提交', async () => {
  const controller = new AbortController(); const calls: Call[] = [];
  const request = sequence([queued(processing, { 'Retry-After': '30' })], calls);
  const pending = requestProviderImage(config, input, controller.signal, request);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 30)); controller.abort();
  await rejected; assert.equal(calls.length, 1);
});
test('S07 调用前已取消，不发送请求', async () => {
  const controller = new AbortController(); controller.abort(); const calls: Call[] = [];
  await assert.rejects(requestProviderImage(config, input, controller.signal, sequence([], calls)), { name: 'AbortError' });
  assert.equal(calls.length, 0);
});
test('S08 HTTP 200 的 failed 是终态；worker_interrupted 提示手动重试且不自动重提', async () => {
  for (const type of ['worker_interrupted', 'upstream_error']) {
    const calls: Call[] = [];
    await assert.rejects(requestProviderImage(config, input, signal(), sequence([
      queued(), polled({ ...processing, status: 'failed', http_status: 500, error: { type, message: 'worker execution failed' } }),
    ], calls)), (error: any) => {
      assert.equal(error.code, 'IMAGE_REQUEST'); assert.match(error.message, type === 'worker_interrupted' ? /中断.*手动重试/ : /worker execution failed/); return true;
    });
    assert.equal(calls.length, 2);
  }
});
test('S09 提交和执行阶段的鉴权、额度及限流错误归类为全局停止码，错误信息隐藏凭据', async () => {
  for (const [status, code] of [[401, 'IMAGE_AUTH'], [403, 'IMAGE_AUTH'], [402, 'IMAGE_QUOTA'], [429, 'IMAGE_RATE_LIMIT']] as const) {
    for (const failedTask of [false, true]) {
      const message = 'secret=' + config.imageApiKey + ' Bearer OTHER_SECRET https://assets.example/image?signature=PRIVATE';
      const responses = failedTask ? [queued(), polled({ status: 'failed', http_status: status, error: { message } })] : [new Response(message, { status })];
      await assert.rejects(requestProviderImage(config, input, signal(), sequence(responses)), (error: any) => {
        assert.equal(error.code, code); assert.equal(error.message.includes(config.imageApiKey), false);
        assert.equal(error.message.includes('OTHER_SECRET'), false); assert.equal(error.message.includes('signature=PRIVATE'), false); return true;
      });
    }
  }
});
test('S10 查询任务 404 明确提示过期或密钥归属问题，不自动换 Key 或重提', async () => {
  const calls: Call[] = [];
  await assert.rejects(requestProviderImage(config, input, signal(), sequence([queued(), Response.json({ error: { code: 'IMAGE_TASK_NOT_FOUND' } }, { status: 404 })], calls)), /任务不存在、已过期或不属于当前 API Key/);
  assert.equal(calls.length, 2);
});
test('S11 跨域、HTTP、带凭据或片段的 poll_url 立即拒绝，避免泄漏密钥', async () => {
  for (const poll_url of ['https://evil.example/v1/images/tasks/imgtask_fixture', '//evil.example/task', 'http://www.sevnx.lol/task', 'https://user:pass@www.sevnx.lol/task', '/v1/images/tasks/imgtask_fixture#fragment']) {
    const calls: Call[] = [];
    await assert.rejects(requestProviderImage(config, input, signal(), sequence([queued({ ...processing, poll_url })], calls)), /同源任务查询地址/);
    assert.equal(calls.length, 1);
  }
});
test('S12 缺少 poll_url 时可使用同源 Location 或当前格式 task_id', async () => {
  for (const withLocation of [false, true]) {
    const calls: Call[] = [];
    const headers = { 'Retry-After': '0', ...(withLocation ? { Location: '/v1/images/tasks/imgtask_fixture' } : {}) };
    await requestProviderImage(config, input, signal(), sequence([queued({ id: 'imgtask_fixture', status: 'processing' }, headers), polled(), new Response(pngBytes)], calls));
    assert.equal(calls[1].url, taskUrl);
  }
});
test('S13 不接受旧 running schema、未知状态、坏 JSON 或同步 HTTP 200 响应', async () => {
  for (const response of [queued({ status: 'running', id: 'old-id' }), queued({ status: 'queued' }), queued(null), new Response('{', { status: 202 }), polled(completed)]) {
    const calls: Call[] = [];
    await assert.rejects(requestProviderImage(config, input, signal(), sequence([response], calls)), /任务状态|任务格式|HTTP 202/);
    assert.equal(calls.length, 1);
  }
});
test('S14 完成结果可从 image_url 下载；缺图、非法地址、非图片及下载 HTTP 错误均不保存', async () => {
  const calls: Call[] = [];
  assert.deepEqual(await requestProviderImage(config, input, signal(), sequence([queued(), polled({ status: 'completed', image_url: resultUrl }), new Response(pngBytes)], calls)), pngBytes);
  for (const url of [undefined, 'http://assets.example/image', 'https://user:pass@assets.example/image', resultUrl + '#fragment']) {
    await assert.rejects(requestProviderImage(config, input, signal(), sequence([queued(), polled({ status: 'completed', image_url: url })])), /HTTPS 图片地址/);
  }
  await assert.rejects(requestProviderImage(config, input, signal(), sequence([queued(), polled(), new Response('not an image')])), /图片格式无效/);
  await assert.rejects(requestProviderImage(config, input, signal(), sequence([queued(), polled(), new Response('failed', { status: 503 })])), /图片下载失败/);
});
test('S15 任务元数据及下载响应有大小上限', async () => {
  await assert.rejects(requestProviderImage(config, input, signal(), sequence([new Response(' '.repeat(1024 * 1024 + 1), { status: 202 })])), /响应过大/);
  await assert.rejects(requestProviderImage(config, input, signal(), sequence([queued(), polled(), new Response(new Uint8Array(MAX_IMAGE_BYTES + 1))])), /响应过大/);
});
test('S16 任务失败或下载时取消，原图、历史草案不变且不遗留新资产', async () => {
  for (const cancelDownload of [false, true]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sub2api-preserve-'));
    try {
      const assets = new ImageTextAssets(dir); const draft = imageTextFixture(); const controller = new AbortController();
      const oldId = await assets.save(pngBytes); draft.pages[0].assetId = oldId; const before = structuredClone(draft);
      const next = sequence([queued(), polled(cancelDownload ? completed : { status: 'failed', error: { type: 'worker_interrupted' } }), new Response(pngBytes)]);
      const request: typeof fetch = async (url, init) => { if (String(url) === resultUrl) controller.abort(); return next(url, init); };
      await assert.rejects(generateImageTextImage({ draft, pageId: 'page-one' }, config, assets, controller.signal, request));
      assert.deepEqual(draft, before); assert.deepEqual(await fs.readdir(assets.directory), [oldId]); assert.deepEqual(await assets.read(oldId), pngBytes);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
});
test('S17 请求前拒绝无密钥、无效 endpoint 及伪造参考图', async () => {
  const calls: Call[] = []; const request = sequence([], calls);
  await assert.rejects(requestProviderImage({ ...config, imageApiKey: '' }, input, signal(), request), { code: 'IMAGE_AUTH' });
  await assert.rejects(requestProviderImage({ ...config, imageEndpoint: 'https://www.sevnx.lol/v1/chat/completions' }, input, signal(), request), /接口完整地址/);
  for (const reference of ['data:image/png;base64,aGVsbG8=', 'data:image/jpeg;base64,' + pngBytes.toString('base64'), 'https://private.example/image.png']) {
    await assert.rejects(requestProviderImage(config, { ...input, references: [reference] }, signal(), request), /参考图|图片格式/);
  }
  assert.equal(calls.length, 0);
});
test('S18 gpt-image-2 的八种草案比例使用合法像素尺寸', () => {
  for (const [ratio, size] of Object.entries(SUB2API_SIZES)) {
    const [width, height] = size.split('x').map(Number); const [rw, rh] = ratio.split(':').map(Number);
    assert.equal(width % 16, 0); assert.equal(height % 16, 0); assert.equal(width * rh, height * rw);
    assert.ok(Math.max(width, height) <= 3840); assert.ok(width * height >= 655360 && width * height <= 8294400);
  }
});

test('S19 异步任务使用 30 分钟总期限，超时结束轮询且不重提', async t => {
  const timeout = new AbortController(); const calls: Call[] = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 30 * 60 * 1000); return timeout.signal;
  });
  const pending = requestProviderImage(config, input, signal(), sequence([queued(processing, { 'Retry-After': '30' })], calls));
  const rejected = assert.rejects(pending, { name: 'TimeoutError' });
  await new Promise(resolve => setTimeout(resolve, 30));
  timeout.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  await rejected; assert.equal(calls.length, 1);
});
test('S20 提交或查询发生网络错误时不自动创建新任务', async () => {
  for (const failPolling of [false, true]) {
    const calls: Call[] = [];
    const request: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (failPolling && init?.method === 'POST') return queued();
      throw new TypeError('fetch failed');
    };
    await assert.rejects(requestProviderImage(config, input, signal(), request), /fetch failed/);
    assert.equal(calls.length, failPolling ? 2 : 1);
  }
});
