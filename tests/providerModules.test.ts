import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalProviderService } from '../electron/services/localProviderService';
import { IMAGE_PRESETS } from '../electron/services/providerConfig';
import { generateImageTextImage, requestProviderImage, SEEDREAM_SIZES } from '../electron/services/imageGenerationService';
import { ImageTextAssets } from '../electron/services/imageTextAssets';
import { imageTextFixture, pngBytes } from './helpers/imageTextFixture';

const storage = { isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from('encrypted:' + Buffer.from(value).toString('base64')),
  decryptString: (value: Buffer) => Buffer.from(value.toString().slice(10), 'base64').toString() };
const initial = { llmBaseUrl: 'https://text.example/v1', llmModel: 'first', llmApiKey: 'text-secret',
  videoParserEndpoint: 'https://extract.example/read', videoParserApiKey: 'extract-secret', videoParserProvider: 'custom' as const,
  ...IMAGE_PRESETS.agnes, imageApiKey: 'image-secret' };
async function fixture(run: (service: LocalProviderService, dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-provider-modules-'));
  try { await run(new LocalProviderService(dir, storage), dir); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}
test('P01 三类接口独立保存，旧表单快照不会覆盖其他模块，重启保留配置且不公开密钥', async () => {
  await fixture(async (service, dir) => {
    service.save(initial);
    service.saveModule('llm', { ...initial, llmApiKey: '', llmModel: 'second' });
    service.saveModule('extraction', { ...initial, videoParserApiKey: '', videoParserEndpoint: 'https://extract.example/new' });
    service.saveModule('image', { ...initial, ...IMAGE_PRESETS.seedream, imageApiKey: 'seedream-secret' });
    const restarted = new LocalProviderService(dir, storage); const actual = restarted.read();
    assert.equal(actual.llmModel, 'second'); assert.equal(actual.llmApiKey, 'text-secret');
    assert.equal(actual.videoParserEndpoint, 'https://extract.example/new'); assert.equal(actual.videoParserApiKey, 'extract-secret');
    assert.equal(actual.imageProtocol, 'seedream'); assert.equal(actual.imageApiKey, 'seedream-secret');
    assert.equal(restarted.publicSettings().imageKeyConfigured, true);
    for (const secret of ['text-secret', 'extract-secret', 'seedream-secret']) assert.ok(!JSON.stringify(restarted.publicSettings()).includes(secret));
    assert.ok(!(await fs.readFile(path.join(dir, 'providers.encrypted'))).includes(Buffer.from('seedream-secret')));
  });
});
test('P02 旧 Agnes 配置自动读取为通用图片配置，其他模块保存后仍可使用', async () => {
  await fixture(async (service, dir) => {
    const old = { llmBaseUrl: '', llmModel: '', videoParserEndpoint: '', agnesApiKey: 'legacy-secret', agnesModel: 'legacy-model' };
    await fs.writeFile(path.join(dir, 'providers.encrypted'), storage.encryptString(JSON.stringify(old)));
    assert.equal(service.read().imageApiKey, 'legacy-secret'); assert.equal(service.publicSettings().imageModel, 'legacy-model');
    service.saveModule('llm', { ...initial, llmApiKey: 'new-text-secret' });
    const restarted = new LocalProviderService(dir, storage);
    assert.equal(restarted.read().imageApiKey, 'legacy-secret'); assert.equal(restarted.read().imageModel, 'legacy-model');
    assert.equal(restarted.read().imageEndpoint, IMAGE_PRESETS.agnes.imageEndpoint);
  });
});
test('P03 当前表单测试只解析配置，不保存；跨服务商不会自动沿用旧密钥', async () => {
  await fixture(async service => {
    service.save(initial);
    const current = service.prepareModule('llm', { ...initial, llmModel: 'unsaved', llmApiKey: '' });
    assert.equal(current.llmModel, 'unsaved'); assert.equal(current.llmApiKey, 'text-secret'); assert.equal(service.read().llmModel, 'first');
    for (const [module, patch] of [
      ['llm', { llmBaseUrl: 'https://other.example/v1', llmApiKey: '' }],
      ['extraction', { videoParserEndpoint: 'https://other.example/read', videoParserApiKey: '' }],
      ['image', { ...IMAGE_PRESETS.seedream, imageApiKey: '' }],
      ['image', { imageEndpoint: 'https://other.example/images', imageApiKey: '' }],
    ] as const) assert.throws(() => service.prepareModule(module, { ...initial, ...patch }), { code: 'INVALID_CONFIG' });
    assert.throws(() => service.saveModule('unknown' as any, initial), { code: 'INVALID_CONFIG' });
    assert.equal(service.read().imageApiKey, 'image-secret');
  });
});
test('P04 无效图片地址或协议不会覆盖已有配置', async () => {
  await fixture(async service => {
    service.save(initial);
    for (const imageEndpoint of ['http://images.example/generate', 'https://user:password@images.example/generate', 'https://images.example/generate?key=secret']) {
      assert.throws(() => service.saveModule('image', { ...initial, imageEndpoint }), { code: 'INVALID_CONFIG' });
    }
    assert.throws(() => service.saveModule('image', { ...initial, imageProtocol: 'unknown' } as any), { code: 'INVALID_CONFIG' });
    assert.equal(service.read().imageEndpoint, initial.imageEndpoint);
  });
});
test('P05 Seedream 文生图使用独立协议和逐页比例，不带 Agnes 专属参数', async () => {
  for (const [ratio, size] of Object.entries(SEEDREAM_SIZES)) {
    let calls = 0;
    const bytes = await requestProviderImage({ ...IMAGE_PRESETS.seedream, imageApiKey: 'fixture' }, { prompt: '测试图片', ratio: ratio as any, references: [] }, new AbortController().signal, async (url, init) => {
      calls++; assert.equal(url, IMAGE_PRESETS.seedream.imageEndpoint); assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body)); assert.equal(body.size, size); assert.equal(body.response_format, 'b64_json');
      assert.equal('return_base64' in body, false); assert.equal('ratio' in body, false); assert.equal('extra_body' in body, false); assert.equal('image' in body, false);
      const [w,h]=size.split('x').map(Number);const [rw,rh]=ratio.split(':').map(Number);assert.ok(Math.abs(w/h-rw/rh)<0.001);
      return Response.json({ data: [{ b64_json: pngBytes.toString('base64') }] });
    });
    assert.deepEqual(bytes, pngBytes); assert.equal(calls, 1);
  }
});
test('P06 Seedream 按页素材与上一版参考去重，只写当前页新图，保留原图与其他页面', async () => {
  await fixture(async (_service, dir) => {
    const assets = new ImageTextAssets(dir); const reference = await assets.save(pngBytes); const draft = imageTextFixture();
    draft.references = [{ id: reference, name: '风格', kind: 'style', width: 1, height: 1 }];
    draft.pages[0].referenceIds = [reference]; draft.pages[0].assetId = reference;
    const original = structuredClone(draft);
    const result = await generateImageTextImage({ draft, pageId: draft.pages[0].id, usePreviousImage: true }, { ...IMAGE_PRESETS.seedream, imageApiKey: 'fixture' }, assets, new AbortController().signal, async (_url, init) => {
      const body = JSON.parse(String(init?.body)); assert.deepEqual(body.image, [await assets.dataURL(reference)]);
      return Response.json({ data: [{ b64_json: pngBytes.toString('base64') }] });
    });
    assert.notEqual(result.assetId, reference); assert.deepEqual(await assets.read(reference), pngBytes); assert.deepEqual(draft, original);
  });
});
test('P07 Seedream 拒绝超量参考、已取消任务、未确认草案及不支持的图片返回，不重试请求', async () => {
  let calls=0; const request: typeof fetch = async () => { calls++; return Response.json({data:[{url:'https://other.example/image'}]}); };
  const config = { ...IMAGE_PRESETS.seedream, imageApiKey: 'fixture' };
  await assert.rejects(requestProviderImage(config, {prompt:'测试',ratio:'1:1',references:Array(11).fill('data:image/png;base64,test')},new AbortController().signal,request),/10/);
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(requestProviderImage(config,{prompt:'测试',ratio:'1:1',references:[]},canceled.signal,request));assert.equal(calls,0);
  await assert.rejects(requestProviderImage(config,{prompt:'测试',ratio:'1:1',references:[]},new AbortController().signal,request),/Base64/); assert.equal(calls,1);
  await fixture(async (_service,dir)=>{const draft=imageTextFixture();draft.confirmed=false;await assert.rejects(generateImageTextImage({draft,pageId:draft.pages[0].id},config,new ImageTextAssets(dir),new AbortController().signal,request),/先核对/);assert.equal(calls,1);});
});
test('P08 自定义 Agnes 兼容地址使用当前配置，Seedream 服务错误不会变成员工账号停用', async () => {
  await requestProviderImage({ ...IMAGE_PRESETS.agnes, imageEndpoint: 'https://proxy.example/images', imageApiKey:'fixture' },{prompt:'测试',ratio:'1:1',references:[]},new AbortController().signal,async url=>{assert.equal(url,'https://proxy.example/images');return Response.json({data:[{b64_json:pngBytes.toString('base64')}]});});
  for (const [status, code] of [[401,'IMAGE_AUTH'],[402,'IMAGE_QUOTA'],[429,'IMAGE_RATE_LIMIT'],[503,'IMAGE_REQUEST']] as const) {
    await assert.rejects(requestProviderImage({...IMAGE_PRESETS.seedream,imageApiKey:'fixture'},{prompt:'测试',ratio:'1:1',references:[]},new AbortController().signal,async()=>Response.json({error:'sensitive upstream details'},{status})),(error:any)=>error.code===code&&!error.message.includes('sensitive'));
  }
});

test('P09 旧提取预设忽略残留地址，迁移后可保存新地址且切回默认地址须新密钥', async () => {
  await fixture(async (service, dir) => {
    await fs.writeFile(path.join(dir, 'providers.encrypted'), storage.encryptString(JSON.stringify({
      llmBaseUrl: '', llmModel: '', videoParserProvider: 'linkdigest', videoParserEndpoint: 'https://previous.example/read', videoParserApiKey: 'legacy-extract',
    })));
    assert.equal(service.read().videoParserEndpoint, '');
    service.saveModule('extraction', { ...initial, videoParserProvider: 'linkdigest', videoParserEndpoint: 'https://proxy.example', videoParserApiKey: 'proxy-key' });
    assert.equal(new LocalProviderService(dir, storage).read().videoParserEndpoint, 'https://proxy.example');
    assert.throws(() => service.prepareModule('extraction', { ...initial, videoParserProvider: 'linkdigest', videoParserEndpoint: '', videoParserApiKey: '' }), { code: 'INVALID_CONFIG' });
  });
});
test('P10 模型名称兼容冒号，非法密钥在保存前被拒绝且原配置保留', async () => {
  await fixture(async service => {
    service.save(initial);
    service.saveModule('image', { ...initial, imageApiKey: '', imageModel: 'custom:model' });
    service.saveModule('llm', { ...initial, llmApiKey: '', llmModel: 'updated' });
    assert.equal(service.read().imageModel, 'custom:model');
    for (const imageApiKey of [null, 42, 'key\ninvalid']) {
      assert.throws(() => service.prepareModule('image', { ...initial, imageApiKey } as any), { code: 'INVALID_CONFIG' });
    }
    assert.equal(service.read().imageApiKey, 'image-secret');
  });
});

test('P11 更换为无需密钥的自定义提取接口时清除旧厂商密钥，切回鉴权不能恢复旧密钥', async () => {
  await fixture(async service => {
    service.save(initial);
    service.saveModule('extraction', { ...initial, videoParserEndpoint: 'https://public.example/read', videoParserApiKey: '', videoParserOptions: { authMode: 'none' } });
    assert.equal(service.read().videoParserApiKey, undefined);
    assert.equal(service.publicSettings().videoKeyConfigured, false);
    assert.equal(service.read().videoParserOptions?.authMode, 'none');
    service.saveModule('extraction', { ...initial, videoParserApiKey: '', videoParserOptions: { authMode: 'bearer' } });
    assert.equal(service.read().videoParserApiKey, undefined);
  });
});

test('P12 清空全部接口及临时文件，重启不恢复旧密钥，重新填写可独立保存', async () => {
  await fixture(async (service, dir) => {
    service.save(initial);
    await fs.writeFile(path.join(dir, 'providers.encrypted.tmp'), 'stale-config');
    await fs.writeFile(path.join(dir, 'business-data.fixture'), '保留业务资料');
    const cleared = service.reset();
    assert.equal(cleared.llmKeyConfigured, false); assert.equal(cleared.videoKeyConfigured, false);
    assert.equal(cleared.imageKeyConfigured, false); assert.equal(cleared.agnesKeyConfigured, false);
    assert.equal(cleared.llmBaseUrl, ''); assert.equal(cleared.llmModel, ''); assert.equal(cleared.videoParserEndpoint, '');
    const restarted = new LocalProviderService(dir, storage);
    assert.deepEqual(restarted.publicSettings(), cleared);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['business-data.fixture']);
    assert.equal(await fs.readFile(path.join(dir, 'business-data.fixture'), 'utf8'), '保留业务资料');
    restarted.saveModule('llm', { llmBaseUrl: 'https://new.example/v1', llmModel: 'new-model', videoParserEndpoint: '', llmApiKey: 'new-secret' });
    assert.equal(restarted.read().llmApiKey, 'new-secret');
    assert.equal(restarted.read().videoParserApiKey, undefined); assert.equal(restarted.read().imageApiKey, undefined);
    restarted.saveModule('image', { ...initial, imageApiKey: '' });
    assert.equal(restarted.read().imageApiKey, undefined); assert.equal(restarted.read().agnesApiKey, undefined);
  });
});
test('P13 无法解密及加密服务不可用时仍可清空，空配置可重复清空', async () => {
  await fixture(async (_service, dir) => {
    await fs.writeFile(path.join(dir, 'providers.encrypted'), 'unreadable');
    const inaccessible = new LocalProviderService(dir, {
      isEncryptionAvailable: () => false,
      encryptString: () => { throw new Error('禁止加密'); },
      decryptString: () => { throw new Error('禁止解密'); },
    });
    assert.throws(() => inaccessible.publicSettings(), { code: 'INVALID_CONFIG' });
    const cleared = inaccessible.reset();
    assert.equal(cleared.llmKeyConfigured, false); assert.equal(cleared.imageKeyConfigured, false); assert.equal(cleared.videoKeyConfigured, false);
    assert.deepEqual(inaccessible.reset(), cleared);
    const recovered = new LocalProviderService(dir, storage);
    recovered.saveModule('image', initial); assert.equal(recovered.read().imageApiKey, 'image-secret');
  });
});
