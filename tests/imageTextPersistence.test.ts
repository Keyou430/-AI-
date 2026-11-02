import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalSQLiteManager } from '../electron/db/sqliteService';
import { StorageLocationService } from '../electron/services/storageLocation';
import { ImageTextAssets, IMAGE_ASSET_DIRECTORY } from '../electron/services/imageTextAssets';
import { LocalProviderService } from '../electron/services/localProviderService';
import { imageTextFixture, pngBytes } from './helpers/imageTextFixture';

test('图文与视频独立持久化，重启迁移后图片、逐页素材及历史均可读取', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'image-text-persist-'));
  const original = path.join(root, 'source'); const target = path.join(root, 'target');
  await fs.mkdir(original); await fs.mkdir(target);
  let db = new LocalSQLiteManager(original);
  try {
    const draft = imageTextFixture(); const assets = new ImageTextAssets(original);
    const id = await assets.save(pngBytes); draft.pages[0].assetId = id;
    draft.references = [{ id, kind: 'scene', name: '实际场景', width: 1, height: 1 }]; draft.pages[0].referenceIds = [id];
    const archived = await assets.save(pngBytes);
    draft.archivedReferences = [{ id: archived, kind: 'scene', name: '已移除但保留历史的场景', width: 1, height: 1 }];
    await db.saveImageTextRecord(draft);
    assert.equal((await db.listRecords()).length, 0); assert.equal((await db.getDatabaseInfo()).totalCount, 1);
    db.close();
    const location = new StorageLocationService(original); location.schedule(target);
    assert.equal(location.activatePending(), await fs.realpath(target));
    assert.deepEqual(await new ImageTextAssets(target).read(id), pngBytes);
    assert.deepEqual(await new ImageTextAssets(target).read(archived), pngBytes);
    assert.deepEqual(await assets.read(id), pngBytes);
    db = new LocalSQLiteManager(target);
    assert.deepEqual(await db.listImageTextRecords(), [draft]);
    await db.deleteImageTextRecord(draft.id); assert.deepEqual(await db.listImageTextRecords(), []);
    const occupied = path.join(root, 'occupied'); await fs.mkdir(occupied); await fs.mkdir(path.join(occupied, IMAGE_ASSET_DIRECTORY));
    assert.throws(() => location.schedule(occupied), /已有图文图片/);
    assert.throws(() => location.schedule(path.join(target, IMAGE_ASSET_DIRECTORY)), /子目录/);
  } finally { db.close(); assert.equal(path.dirname(root), os.tmpdir()); await fs.rm(root, { recursive: true, force: true }); }
});
test('Agnes 密钥本机加密保存，公开配置不返回密钥，旧配置保存不丢失 Agnes 配置', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agnes-config-'));
  const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s).reverse(), decryptString: (b: Buffer) => Buffer.from(b).reverse().toString() };
  try {
    const service = new LocalProviderService(root, storage);
    service.save({ llmBaseUrl: '', llmModel: '', videoParserEndpoint: '', agnesApiKey: 'agnes-private', agnesModel: 'agnes-image-2.5-flash' });
    const reopened = new LocalProviderService(root, storage);
    assert.equal(reopened.read().agnesApiKey, 'agnes-private'); assert.equal(reopened.publicSettings().agnesKeyConfigured, true);
    assert.equal(JSON.stringify(reopened.publicSettings()).includes('agnes-private'), false);
    assert.equal((await fs.readFile(path.join(root, 'providers.encrypted'))).includes(Buffer.from('agnes-private')), false);
    reopened.save({ llmBaseUrl: '', llmModel: '', videoParserEndpoint: '' });
    assert.equal(reopened.read().agnesApiKey, 'agnes-private');
    assert.throws(() => reopened.save({ llmBaseUrl: '', llmModel: '', videoParserEndpoint: '', agnesApiKey: 'bad\nkey' }), /格式无效/);
    assert.equal(reopened.read().agnesApiKey, 'agnes-private');
  } finally { assert.equal(path.dirname(root), os.tmpdir()); await fs.rm(root, { recursive: true, force: true }); }
});

test('全部页面版本独立表跨重启恢复，删除页面不移除已有成功版本', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'image-versions-'));let db=new LocalSQLiteManager(root);
  try{
    const {appendPageVersion}=await import('../electron/services/imageTextReview');
    const {pageRenderKey}=await import('../electron/services/imageTextModel');
    let n=0;let d=imageTextFixture();d=appendPageVersion(d,'page-one',{assetId:'new-version',renderedKey:pageRenderKey(d,d.pages[0])},()=> 'version-'+(++n));
    const all=[...d.versions!];d.pages=d.pages.filter(p=>p.id!=='page-one');await db.saveImageTextRecord(d);db.close();db=new LocalSQLiteManager(root);
    const restored=(await db.listImageTextRecords())[0];assert.deepEqual(restored.versions,JSON.parse(JSON.stringify(all)));assert.equal(restored.pages.length,1);
    assert.equal((await db.getDatabaseInfo()).totalCount,1);
  }finally{db.close();assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});}
});
