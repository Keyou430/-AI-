import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateAgnesImage } from '../electron/services/agnesImageService';
import { ImageTextAssets } from '../electron/services/imageTextAssets';
import { imageTextFixture, pngBytes } from './helpers/imageTextFixture';

test('Agnes 协议按官方示例区分文生图与参考图，响应落盘不持久化 Base64', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agnes-images-'));
  const assets = new ImageTextAssets(directory);
  const requests: any[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://apihub.agnes-ai.com/v1/images/generations');
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ data: [{ b64_json: pngBytes.toString('base64') }] });
  };
  try {
    const draft = imageTextFixture();
    const result = await generateAgnesImage({ draft, pageId: 'page-one' }, { agnesApiKey: 'test-key' }, assets, new AbortController().signal, request);
    assert.equal(requests[0].return_base64, true); assert.equal(requests[0].ratio, '1:1'); assert.equal(requests[0].size, '1K');
    assert.equal('extra_body' in requests[0], false);
    assert.deepEqual(await assets.read(result.assetId), pngBytes);
    draft.references = [{ id: result.assetId, name: '原帖', kind: 'style', width: 1, height: 1 }];
    await generateAgnesImage({ draft, pageId: 'page-one' }, { agnesApiKey: 'test-key' }, assets, new AbortController().signal, request);
    assert.equal(requests[1].extra_body.response_format, 'b64_json');
    assert.equal(requests[1].extra_body.image[0], await assets.dataURL(result.assetId));
    assert.equal('response_format' in requests[1], false); assert.equal('return_base64' in requests[1], false);
    draft.pages[0].assetId = result.assetId;
    await generateAgnesImage({ draft, pageId: 'page-one', usePreviousImage: true }, { agnesApiKey: 'test-key' }, assets, new AbortController().signal, request);
    assert.equal(requests[2].extra_body.image.length,1); // 同一张图片同时作为风格与上一版参考时去重。
    draft.references = [];
    await generateAgnesImage({ draft, pageId: 'page-one', usePreviousImage: true }, { agnesApiKey: 'test-key' }, assets, new AbortController().signal, request);
    assert.equal(requests[3].extra_body.image[0],await assets.dataURL(result.assetId));
    await assert.rejects(assets.read('../outside'), /标识无效/);
  } finally { assert.equal(path.dirname(directory), os.tmpdir()); await fs.rm(directory, { recursive: true, force: true }); }
});
test('未确认、无密钥、取消及无效响应均不写入新图，也不自动重试计费请求', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agnes-errors-'));
  try {
    const assets = new ImageTextAssets(directory); const draft = imageTextFixture(); let calls = 0;
    const request: typeof fetch = async () => { calls++; return Response.json({ data: [{ url: 'https://example.com/file' }] }); };
    const args = { draft, pageId: 'page-one' };
    draft.confirmed = false;
    await assert.rejects(generateAgnesImage(args, { agnesApiKey: 'fixture' }, assets, new AbortController().signal, request), /先核对/);
    draft.confirmed = true;
    await assert.rejects(generateAgnesImage(args, {}, assets, new AbortController().signal, request), /密钥/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(generateAgnesImage(args, { agnesApiKey: 'fixture' }, assets, controller.signal, request));
    assert.equal(calls, 0);
    await assert.rejects(generateAgnesImage(args, { agnesApiKey: 'fixture' }, assets, new AbortController().signal, request), /Base64/);
    assert.equal(calls, 1); assert.deepEqual(await fs.readdir(directory), []);
  } finally { assert.equal(path.dirname(directory), os.tmpdir()); await fs.rm(directory, { recursive: true, force: true }); }
});

test('F05 供应商状态码保留可判断分类，单页服务故障不误判为全局鉴权失败', async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'agnes-status-'));
  try{
    const assets=new ImageTextAssets(directory);const draft=imageTextFixture();
    for(const [status,code] of [[401,'AGNES_AUTH'],[403,'AGNES_AUTH'],[402,'AGNES_QUOTA'],[429,'AGNES_RATE_LIMIT'],[503,'AGNES_REQUEST']] as const){
      await assert.rejects(generateAgnesImage({draft,pageId:'page-one'},{agnesApiKey:'fixture'},assets,new AbortController().signal,async()=>Response.json({}, {status})),(error:any)=>error.code===code&&error.message.includes(String(status)));
    }
    assert.deepEqual(await fs.readdir(directory),[]);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});