import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Server } from 'node:http';
import { LocalProviderService } from '../electron/services/localProviderService';
import { createAuthServer } from '../server/authServer';
import { RemoteAuthService } from '../electron/services/remoteAuthService';
import { LocalSQLiteManager } from '../electron/db/sqliteService';

const config = { llmBaseUrl: 'https://provider.example/v1', llmModel: 'initial-model', llmApiKey: 'initial-secret',
  videoParserEndpoint: 'https://provider.example/parse', videoParserApiKey: 'parser-secret' };
const empty = { llmBaseUrl: '', llmModel: '', videoParserEndpoint: '', llmKeyConfigured: false, videoKeyConfigured: false };
const key = randomBytes(32);
const storage = { isEncryptionAvailable: () => true,
  encryptString(value: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); },
  decryptString(value: Buffer) { const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'); },
};

test('本机密钥加密长存、修改覆盖、空输入保留；新设备为空，无法解密时不静默覆盖', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-local-persist-'));
  try {
    const first = new LocalProviderService(path.join(directory, 'first'), storage);
    assert.deepEqual(first.publicSettings(), empty);
    first.save(config);
    const file = await fs.readFile(path.join(directory, 'first', 'providers.encrypted'));
    assert.equal(file.includes(Buffer.from(config.llmApiKey)), false);
    const restarted = new LocalProviderService(path.join(directory, 'first'), storage);
    assert.equal(restarted.read().llmApiKey, config.llmApiKey);
    restarted.save({ ...config, llmModel: 'updated-model', llmApiKey: 'updated-secret', videoParserApiKey: '' });
    const again = new LocalProviderService(path.join(directory, 'first'), storage);
    assert.equal(again.read().llmApiKey, 'updated-secret'); assert.equal(again.read().llmModel, 'updated-model');
    assert.equal(again.read().videoParserApiKey, config.videoParserApiKey);
    assert.deepEqual(new LocalProviderService(path.join(directory, 'second'), storage).publicSettings(), empty);
    assert.throws(() => new LocalProviderService(path.join(directory, 'first'), { ...storage, isEncryptionAvailable: () => false }).save(config), { code: 'INVALID_CONFIG' });
    assert.throws(() => new LocalProviderService(path.join(directory, 'first'), { ...storage, decryptString() { throw new Error(); } }).save(config), { code: 'INVALID_CONFIG' });
    assert.equal(new LocalProviderService(path.join(directory, 'first'), storage).read().llmApiKey, 'updated-secret');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('本机配置不依赖授权服务，服务器重启不会保存或改变本机密钥，新设备为空', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-local-auth-'));
  let server: Server | undefined;
  const password = 'Device-persistence-12345';
  const launch = async () => {
    server = await createAuthServer({ dataDirectory: path.join(directory, 'server'), adminPassword: password });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    return 'http://127.0.0.1:' + (server!.address() as { port: number }).port;
  };
  const stop = async () => { await new Promise<void>(resolve => { server!.close(() => resolve()); server!.closeAllConnections(); }); server = undefined; };
  try {
    const first = new LocalProviderService(path.join(directory, 'first'), storage);
    let url = await launch(); let client = new RemoteAuthService(url, 2000, true);
    await client.login(1, 'admin', password);
    first.save(config); first.save({ ...config, llmApiKey: 'updated-secret' });
    await client.logout(1); await stop();
    assert.equal(new LocalProviderService(path.join(directory, 'first'), storage).read().llmApiKey, 'updated-secret');
    url = await launch(); client = new RemoteAuthService(url, 2000, true); await client.login(1, 'admin', password);
    assert.deepEqual(new LocalProviderService(path.join(directory, 'second'), storage).publicSettings(), empty);
    assert.equal((await fs.readdir(path.join(directory, 'server'))).some(name => name.includes('provider')), false);
    await client.logout(1);
  } finally { if (server) await stop(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('新设备知识库为空，原设备导入及更新文档跨重启保留', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-device-knowledge-'));
  let first = new LocalSQLiteManager(path.join(directory, 'first')); const second = new LocalSQLiteManager(path.join(directory, 'second'));
  try {
    assert.deepEqual(await first.listKnowledgeDocs(), []);
    const doc = { id: 'persistent-doc', name: '企业.txt', filePath: '', fileType: 'txt', sizeBytes: 6,
      uploadedAt: new Date().toISOString(), fullContent: '首次内容', contentSnippet: '首次内容', charCount: 4, enabled: true };
    await first.upsertKnowledgeDoc(doc); await first.upsertKnowledgeDoc({ ...doc, fullContent: '修改内容', contentSnippet: '修改内容' });
    first.close(); first = new LocalSQLiteManager(path.join(directory, 'first'));
    assert.equal((await first.listKnowledgeDocs())[0].fullContent, '修改内容');
    assert.deepEqual(await second.listKnowledgeDocs(), []);
  } finally { first.close(); second.close(); await fs.rm(directory, { recursive: true, force: true }); }
});


test('前端通用解析协议加密保存并在重启后保持，公开配置不含密钥', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-parser-config-'));
  const options = { method: 'GET', authMode: 'query', apiKeyName: 'api_key', urlField: 'share_url',
    textPath: 'data.audio_text', titlePath: 'data.desc', timeoutSeconds: 120 } as const;
  try {
    const service = new LocalProviderService(directory, storage);
    const saved = service.save({ ...config, videoParserOptions: options });
    assert.deepEqual(saved.videoParserOptions, options);
    const restarted = new LocalProviderService(directory, storage);
    assert.deepEqual(restarted.read().videoParserOptions, options);
    assert.equal(restarted.read().videoParserApiKey, config.videoParserApiKey);
    assert.equal(JSON.stringify(restarted.publicSettings()).includes(config.videoParserApiKey), false);
    assert.equal((await fs.readFile(path.join(directory, 'providers.encrypted'))).includes(Buffer.from(config.videoParserApiKey)), false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});


test('无效通用协议配置被拒绝且不覆盖已有配置，旧客户端保存继续保留协议', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-parser-validation-'));
  const options = { method: 'GET', authMode: 'query', apiKeyName: 'api_key', urlField: 'url',
    textPath: 'data.audio_text', titlePath: '', timeoutSeconds: 120 } as const;
  try {
    const service = new LocalProviderService(directory, storage);
    service.save({ ...config, videoParserOptions: options });
    for (const invalid of [
      { method: 'DELETE' }, { authMode: 'invalid' }, { apiKeyName: 'bad\r\nHeader' },
      { apiKeyName: 'url' }, { textPath: 'data.__proto__.secret' }, { textPath: 'data[0].text' },
      { timeoutSeconds: 0 }, { timeoutSeconds: 301 },
    ]) {
      assert.throws(() => service.save({ ...config, videoParserOptions: { ...options, ...invalid } } as any), { code: 'INVALID_CONFIG' });
      assert.deepEqual(service.read().videoParserOptions, options);
    }
    service.save({ ...config, videoParserApiKey: '' });
    assert.deepEqual(service.publicSettings().videoParserOptions, options);
    assert.equal(service.read().videoParserApiKey, config.videoParserApiKey);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});


test('聚合预设只需一把 Key，无需地址；跨重启保存且切换厂商须新 Key', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-yaoan-config-'));
  try {
    const service = new LocalProviderService(directory, storage);
    service.save({llmBaseUrl:'',llmModel:'',videoParserEndpoint:'',videoParserProvider:'yaoan',videoParserApiKey:'fixture-yaoan-secret'});
    const restarted = new LocalProviderService(directory, storage);
    assert.equal(restarted.publicSettings().videoParserProvider, 'yaoan');
    assert.equal(restarted.read().videoParserApiKey, 'fixture-yaoan-secret');
    assert.equal(JSON.stringify(restarted.publicSettings()).includes('fixture-yaoan-secret'), false);
    restarted.save({llmBaseUrl:'',llmModel:'',videoParserEndpoint:'',videoParserApiKey:''});
    assert.equal(restarted.read().videoParserProvider, 'yaoan');
    assert.throws(() => restarted.save({...config,videoParserProvider:'custom',videoParserApiKey:''}), {code:'INVALID_CONFIG'});
    assert.equal(restarted.read().videoParserProvider, 'yaoan');
    restarted.save({...config,videoParserProvider:'custom',videoParserApiKey:'new-fixture-secret'});
    assert.equal(restarted.read().videoParserApiKey, 'new-fixture-secret');
    assert.throws(() => restarted.save({...config,videoParserProvider:'invalid'} as any), {code:'INVALID_CONFIG'});
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});


test('LinkDigest Key 与积分上限加密长存，切换厂商要新 Key，新设备保持空白', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'remix-linkdigest-config-'));
  try{
    const service=new LocalProviderService(directory,storage);
    service.save({llmBaseUrl:'',llmModel:'',videoParserEndpoint:'',videoParserProvider:'linkdigest',videoParserApiKey:'ld_fixture_secret',linkDigestMaxCredits:7});
    const restarted=new LocalProviderService(directory,storage);
    assert.equal(restarted.publicSettings().videoParserProvider,'linkdigest');assert.equal(restarted.publicSettings().linkDigestMaxCredits,7);
    assert.equal(restarted.read().videoParserApiKey,'ld_fixture_secret');
    for(const linkDigestMaxCredits of [0,1.5,1001,null,'5'])assert.throws(()=>restarted.save({...restarted.read(),linkDigestMaxCredits} as any),{code:'INVALID_CONFIG'});
    restarted.save({...restarted.read(),videoParserApiKey:'',linkDigestMaxCredits:8});
    assert.equal(restarted.read().videoParserApiKey,'ld_fixture_secret');assert.equal(restarted.read().linkDigestMaxCredits,8);
    assert.throws(()=>restarted.save({...restarted.read(),videoParserProvider:'yaoan',videoParserApiKey:''}),{code:'INVALID_CONFIG'});
    assert.equal(JSON.stringify(restarted.publicSettings()).includes('ld_fixture_secret'),false);
    assert.deepEqual(new LocalProviderService(path.join(directory,'fresh'),storage).publicSettings(),empty);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});


test('接口地址校验指出具体字段，失败不覆盖已保存配置或泄露密钥', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-config-error-'));
  try {
    const service = new LocalProviderService(directory, storage); service.save(config);
    for (const [field, label] of [['llmBaseUrl', '模型接口地址'], ['videoParserEndpoint', '内容提取接口地址']] as const) {
      assert.throws(() => service.save({ ...config, [field]: 'http://invalid.example/?key=private-secret' }), error => {
        assert.ok(error instanceof Error); assert.ok(error.message.includes(label)); assert.ok(error.message.includes('HTTPS'));
        assert.ok(!error.message.includes('private-secret')); return true;
      });
      assert.equal(service.read().llmApiKey, config.llmApiKey);
      assert.equal(service.read().llmBaseUrl, config.llmBaseUrl);
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
