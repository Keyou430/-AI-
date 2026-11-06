import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IMAGE_PRESETS } from '../electron/services/providerConfig';
import { LocalProviderService } from '../electron/services/localProviderService';
import { generateImageTextImage, GLM_SIZES, requestProviderImage } from '../electron/services/imageGenerationService';
import { ImageTextAssets, MAX_IMAGE_BYTES } from '../electron/services/imageTextAssets';
import { imageTextFixture, pngBytes } from './helpers/imageTextFixture';

const config = { ...IMAGE_PRESETS.glm, imageApiKey: 'glm-fixture-key' };
const input = { prompt: '中文图文图片', ratio: '1:1' as const, references: [] as string[] };
const imageURL = 'https://images.example/generated.png?signature=fixture';
const storage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString() };

test('G01 GLM 预设独立保存并在重启后恢复，更换厂商不能沿用其他厂商密钥', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glm-config-'));
  try {
    const service = new LocalProviderService(directory, storage);
    const initial = { llmBaseUrl: 'https://text.example/v1', llmModel: 'text-model', llmApiKey: 'text-key',
      videoParserEndpoint: '', ...IMAGE_PRESETS.agnes, imageApiKey: 'agnes-key' };
    service.save(initial);
    assert.throws(() => service.saveModule('image', { ...initial, ...config, imageApiKey: '' }), { code: 'INVALID_CONFIG' });
    service.saveModule('image', { ...initial, ...config });
    const restarted = new LocalProviderService(directory, storage);
    assert.equal(restarted.read().imageProtocol, 'glm');
    assert.equal(restarted.read().imageEndpoint, IMAGE_PRESETS.glm.imageEndpoint);
    assert.equal(restarted.read().imageModel, 'glm-image');
    assert.equal(restarted.read().imageApiKey, config.imageApiKey);
    assert.equal(restarted.read().llmApiKey, 'text-key');
    assert.equal(restarted.publicSettings().imageKeyConfigured, true);
    assert.equal(JSON.stringify(restarted.publicSettings()).includes(config.imageApiKey), false);
    restarted.saveModule('image', { ...initial, ...config, imageApiKey: '' });
    assert.equal(restarted.read().imageApiKey, config.imageApiKey);
    assert.throws(() => restarted.saveModule('image', { ...initial, imageApiKey: '' }), { code: 'INVALID_CONFIG' });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('G02 GLM 八种比例使用官方尺寸约束，下载临时图片且不向图片地址传递 API Key', async () => {
  for (const [ratio, size] of Object.entries(GLM_SIZES)) {
    let calls = 0;
    const result = await requestProviderImage(config, { ...input, ratio: ratio as keyof typeof GLM_SIZES }, new AbortController().signal, async (url, init) => {
      calls++;
      assert.equal(init?.redirect, 'error');
      if (calls === 1) {
        assert.equal(url, IMAGE_PRESETS.glm.imageEndpoint);
        assert.equal(init?.method, 'POST');
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + config.imageApiKey);
        assert.deepEqual(JSON.parse(String(init?.body)), { model: 'glm-image', prompt: input.prompt, size, watermark_enabled: false });
        return Response.json({ data: [{ url: imageURL }] });
      }
      assert.equal(url, imageURL); assert.equal(init?.method, 'GET');
      assert.equal(new Headers(init?.headers).get('Authorization'), null);
      assert.equal(init?.body, undefined);
      return new Response(pngBytes);
    });
    const [width, height] = size.split('x').map(Number);
    const [rw, rh] = ratio.split(':').map(Number);
    assert.equal(width % 32, 0); assert.equal(height % 32, 0);
    assert.ok(width * height <= 2 ** 22); assert.ok(Math.abs(width / height - rw / rh) < 0.001);
    assert.equal(calls, 2); assert.deepEqual(result, pngBytes);
  }
});
test('G03 GLM 参考图与超长提示词在请求前明确拒绝，不截断内容或自动重试', async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls++; return Response.json({}); };
  for (const value of [{ ...input, references: ['data:image/png;base64,fixture'] }, { ...input, prompt: '字'.repeat(1001) }]) {
    await assert.rejects(requestProviderImage(config, value, new AbortController().signal, request), (error: any) => error.code === 'IMAGE_PAGE_UNSUPPORTED');
  }
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(requestProviderImage(config, input, canceled.signal, request));
  await assert.rejects(requestProviderImage({ ...config, imageApiKey: '' }, input, new AbortController().signal, request), (error: any) => error.code === 'IMAGE_AUTH');
  assert.equal(calls, 0);
  const longPrompt = '字'.repeat(1000);
  await requestProviderImage(config, { ...input, prompt: longPrompt }, new AbortController().signal, async (_url, init) => {
    if (init?.method === 'POST') { assert.equal(JSON.parse(String(init.body)).prompt, longPrompt); return Response.json({ data: [{ url: imageURL }] }); }
    return new Response(pngBytes);
  });
});
test('G04 GLM 上游错误保留分类，不回显供应商正文或重试计费请求', async () => {
  for (const [status, code] of [[401, 'IMAGE_AUTH'], [403, 'IMAGE_AUTH'], [402, 'IMAGE_QUOTA'], [429, 'IMAGE_RATE_LIMIT'], [503, 'IMAGE_REQUEST']] as const) {
    let calls = 0;
    await assert.rejects(requestProviderImage(config, input, new AbortController().signal, async () => {
      calls++; return Response.json({ error: 'PRIVATE_UPSTREAM_MESSAGE' }, { status });
    }), (error: any) => error.code === code && error.message.includes('GLM') && !error.message.includes('PRIVATE_UPSTREAM_MESSAGE'));
    assert.equal(calls, 1);
  }
});
test('G05 GLM 拒绝缺失、非 HTTPS 或携带用户凭据的图片地址，不发送下载请求', async () => {
  for (const result of [{ b64_json: pngBytes.toString('base64') }, {}, { url: 'http://images.example/file' },
    { url: 'https://user:password@images.example/file' }, { url: 'https://images.example/file#fragment' }]) {
    let calls = 0;
    await assert.rejects(requestProviderImage(config, input, new AbortController().signal, async () => {
      calls++; return Response.json({ data: [result] });
    }), /HTTPS 图片地址/);
    assert.equal(calls, 1);
  }
});
test('G06 GLM 图片下载拒绝重定向、失效链接、非图片和超过 20 MB 的响应', async () => {
  for (const [download, expected] of [
    [() => new Response(null, { status: 302, headers: { Location: 'https://other.example/file' } }), /HTTP 302/],
    [() => new Response(null, { status: 403 }), /HTTP 403/],
    [() => new Response('<html>not an image</html>'), /图片格式无效/],
    [() => new Response(Buffer.alloc(MAX_IMAGE_BYTES + 1)), /图片响应过大/],
  ] as const) {
    let calls = 0;
    await assert.rejects(requestProviderImage(config, input, new AbortController().signal, async () => {
      calls++; return calls === 1 ? Response.json({ data: [{ url: imageURL }] }) : download();
    }), expected);
    assert.equal(calls, 2);
  }
});
test('G07 GLM 下载后只保存新图片，保留其他页面与原图，不持久化临时图片地址', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glm-assets-'));
  try {
    const assets = new ImageTextAssets(directory); const oldAsset = await assets.save(pngBytes);
    const draft = imageTextFixture(); draft.pages[0].assetId = oldAsset;
    draft.references.push({ id: 'unbound-scene', name: '未绑定场景.png', kind: 'scene', width: 32, height: 32 });
    const before = structuredClone(draft);
    let calls = 0;
    const result = await generateImageTextImage({ draft, pageId: 'page-one' }, config, assets, new AbortController().signal, async () => {
      calls++; return calls === 1 ? Response.json({ data: [{ url: imageURL }] }) : new Response(pngBytes);
    });
    assert.equal(calls, 2); assert.notEqual(result.assetId, oldAsset); assert.deepEqual(draft, before);
    assert.deepEqual(await assets.read(result.assetId), pngBytes); assert.deepEqual(await assets.read(oldAsset), pngBytes);
    assert.equal(JSON.stringify(result).includes('images.example'), false);
    await assert.rejects(generateImageTextImage({ draft, pageId: 'page-one', usePreviousImage: true }, config, assets, new AbortController().signal), (error: any) => error.code === 'IMAGE_PAGE_UNSUPPORTED');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('G08 GLM 下载期间取消不落盘，也不删除旧图', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glm-cancel-'));
  try {
    const assets = new ImageTextAssets(directory); const oldAsset = await assets.save(pngBytes);
    const draft = imageTextFixture(); draft.pages[0].assetId = oldAsset;
    const controller = new AbortController(); let calls = 0;
    await assert.rejects(generateImageTextImage({ draft, pageId: 'page-one' }, config, assets, controller.signal, async () => {
      calls++; if (calls === 1) return Response.json({ data: [{ url: imageURL }] });
      controller.abort(); return new Response(pngBytes);
    }));
    assert.deepEqual(await fs.readdir(assets.directory), [oldAsset]);
    assert.deepEqual(await assets.read(oldAsset), pngBytes);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('G10 GLM 按参考图来源区分整套与单页错误，在读取素材前拒绝并保留草案', async () => {
  for (const source of ['style', 'scene', 'previous', 'combined'] as const) {
    const draft = imageTextFixture();
    const style = source === 'style' || source === 'combined';
    const scene = source === 'scene' || source === 'combined';
    const previous = source === 'previous' || source === 'combined';
    if (style) draft.references.push({ id: 'style-reference', name: '风格.png', kind: 'style', width: 32, height: 32 });
    if (scene) {
      draft.references.push({ id: 'scene-reference', name: '场景.png', kind: 'scene', width: 32, height: 32 });
      draft.pages[0].referenceIds = ['scene-reference'];
    }
    const before = structuredClone(draft); let reads = 0; let calls = 0;
    const assets = { dataURL: async () => { reads++; return 'data:image/png;base64,fixture'; } } as unknown as ImageTextAssets;
    await assert.rejects(generateImageTextImage({ draft, pageId: 'page-one', usePreviousImage: previous }, config, assets,
      new AbortController().signal, async () => { calls++; return Response.json({}); }), (error: any) => {
      assert.equal(error.code, style ? 'IMAGE_UNSUPPORTED' : 'IMAGE_PAGE_UNSUPPORTED');
      assert.match(error.message, /当前 GLM-Image 接入/); assert.match(error.message, /第 1 张/);
      if (style) assert.match(error.message, /整套风格参考图 1 张/);
      if (scene) assert.match(error.message, /本页绑定参考图 1 张/);
      if (previous) assert.match(error.message, /本页上一版图片/);
      return true;
    });
    assert.equal(reads, 0); assert.equal(calls, 0); assert.deepEqual(draft, before);
  }
});

test('G11 旧 GLM 图生图配置只迁移图片字段，清除旧图片密钥并加密落盘，重复读取稳定', async () => {
  for (const imageEndpoint of ['http://localhost:30000/v1/images/generations', 'https://private.example/v1/images/edits']) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glm-migration-'));
    try {
      let writes = 0;
      const encryptedStorage = { isEncryptionAvailable: () => true,
        encryptString: (value: string) => { writes++; return Buffer.from(Buffer.from(value).toString('base64')); },
        decryptString: (value: Buffer) => Buffer.from(value.toString(), 'base64').toString() };
      const legacy = { llmBaseUrl: 'https://text.example/v1', llmModel: 'text-model', llmApiKey: 'text-key',
        videoParserEndpoint: 'https://extract.example/api', videoParserProvider: 'custom', videoParserApiKey: 'extract-key',
        agnesModel: 'agnes-image-2.5-flash', agnesApiKey: 'agnes-key',
        imageProtocol: 'glm-sglang', imageEndpoint, imageModel: 'zai-org/GLM-Image', imageApiKey: 'retired-glm-key' };
      const file = path.join(directory, 'providers.encrypted');
      await fs.writeFile(file, encryptedStorage.encryptString(JSON.stringify(legacy))); writes = 0;
      const service = new LocalProviderService(directory, encryptedStorage);
      const expected = { ...legacy, ...IMAGE_PRESETS.glm, imageApiKey: undefined };
      assert.deepEqual(service.read(), expected);
      assert.equal(service.publicSettings().imageKeyConfigured, false);
      for (const secret of ['text-key', 'extract-key', 'agnes-key', 'retired-glm-key']) {
        assert.equal(JSON.stringify(service.publicSettings()).includes(secret), false);
      }
      const persisted = await fs.readFile(file);
      const { imageApiKey: _removed, ...storedExpected } = expected;
      assert.deepEqual(JSON.parse(encryptedStorage.decryptString(persisted)), storedExpected);
      assert.equal(persisted.includes(Buffer.from('retired-glm-key')), false);
      assert.deepEqual(new LocalProviderService(directory, encryptedStorage).read(), expected);
      assert.deepEqual(await fs.readFile(file), persisted); assert.equal(writes, 1);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
});
test('G12 已支持的三家配置读取时保持地址、模型、密钥及原文件不变', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glm-unchanged-'));
  try {
    for (const preset of Object.values(IMAGE_PRESETS)) {
      const value = { llmBaseUrl: '', llmModel: '', videoParserEndpoint: '', ...preset, imageApiKey: 'saved-key' };
      const file = path.join(directory, 'providers.encrypted');
      await fs.writeFile(file, JSON.stringify(value));
      const before = await fs.readFile(file);
      const service = new LocalProviderService(directory, { ...storage, encryptString: () => { throw new Error('读取现有配置不应改写'); } });
      assert.deepEqual(service.read(), value);
      assert.equal(service.publicSettings().imageKeyConfigured, true);
      assert.deepEqual(await fs.readFile(file), before);
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('G13 不再接受图生图协议、本机 HTTP 地址或自部署模型名', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glm-retired-'));
  try {
    const service = new LocalProviderService(directory, storage);
    const value = { llmBaseUrl: '', llmModel: '', videoParserEndpoint: '', ...config };
    assert.throws(() => service.save({ ...value, imageProtocol: 'glm-sglang' as any }), { code: 'INVALID_CONFIG' });
    assert.throws(() => service.save({ ...value, imageEndpoint: 'http://localhost:30000/v1/images/generations' }), { code: 'INVALID_CONFIG' });
    assert.throws(() => service.save({ ...value, imageModel: 'zai-org/GLM-Image' }), { code: 'INVALID_CONFIG' });
    assert.equal((await fs.readdir(directory)).length, 0);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
