import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ImageAssetLocationService } from '../electron/services/imageAssetLocation';
import { ImageTextAssets } from '../electron/services/imageTextAssets';
import { StorageLocationService } from '../electron/services/storageLocation';
import { LocalSQLiteManager } from '../electron/db/sqliteService';
import { deleteImageTextWithAssets, imageTextDeletionInfo, recoverImageTextCleanup } from '../electron/services/imageTextDeletion';
import { imageTextFixture, pngBytes } from './helpers/imageTextFixture';

test('素材独立目录下次启动迁移，保留原图，可返回跟随数据且不覆盖冲突文件', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'image-location-')); const data=path.join(root,'data'),independent=path.join(root,'independent');
  await fs.mkdir(data);await fs.mkdir(independent);
  try {
    let service=new ImageAssetLocationService(root);const id=await new ImageTextAssets(data).save(pngBytes);
    assert.equal(service.get(data).followsData,true);service.schedule(independent,data);
    assert.equal(service.root(data),data);service=new ImageAssetLocationService(root);service.activatePending(data);
    assert.equal(service.root(data),independent);assert.deepEqual(await new ImageTextAssets(independent).read(id),pngBytes);
    assert.deepEqual(await new ImageTextAssets(data).read(id),pngBytes);assert.equal(service.get(data).bytes,pngBytes.length);
    const second=await new ImageTextAssets(independent).save(pngBytes);service.schedule(undefined,data);service.activatePending(data);
    assert.equal(service.root(data),data);assert.deepEqual(await new ImageTextAssets(data).read(second),pngBytes);
  } finally {assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});}
});
test('素材迁移目标被占用时保持原地址；独立素材不随数据库搬迁',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'image-location-conflict-'));const data=path.join(root,'data'),target=path.join(root,'target'),newData=path.join(root,'new-data');
  await fs.mkdir(data);await fs.mkdir(target);await fs.mkdir(newData);let db=new LocalSQLiteManager(data);
  try{
    await db.ensureInitialized();db.close();const service=new ImageAssetLocationService(root);await new ImageTextAssets(data).save(pngBytes);
    service.schedule(target,data);await new ImageTextAssets(target).save(pngBytes);service.activatePending(data);
    assert.equal(service.root(data),data);assert.match(service.get(data).migrationError!,/已有/);
    const storage=new StorageLocationService(data,false);storage.schedule(newData);assert.equal(storage.activatePending(),realpathSync(newData));
    assert.equal((await fs.readdir(data)).includes('image-text-assets'),true);assert.equal((await fs.readdir(newData)).includes('image-text-assets'),false);
  }finally{db.close();assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});}
});
test('整条历史删除清理所有版本与参考图，跨记录共用素材保留；删除失败回滚',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'image-delete-'));const assets=new ImageTextAssets(root);const db=new LocalSQLiteManager(root);
  try{
    const d=imageTextFixture();const a=await assets.save(pngBytes),b=await assets.save(pngBytes),shared=await assets.save(pngBytes),archived=await assets.save(pngBytes);
    d.pages[0].assetId=a;d.pages[1].assetId=b;d.references=[{id:shared,name:'共享',kind:'scene',width:1,height:1}];
    d.archivedReferences=[{id:archived,name:'已移除场景',kind:'scene',width:1,height:1}];
    await db.saveImageTextRecord(d);const other={...d,id:'other',pages:[],references:[d.references[0]],archivedReferences:[]};await db.saveImageTextRecord(other);
    const info=await imageTextDeletionInfo(db,assets,d.id);assert.equal(info.count,3);assert.equal(info.bytes,pngBytes.length*3);
    const originalDelete=db.deleteImageTextRecord.bind(db);db.deleteImageTextRecord=async()=>{throw new Error('数据库写入失败');};
    await assert.rejects(deleteImageTextWithAssets(db,assets,d.id),/写入失败/);assert.deepEqual(await assets.read(a),pngBytes);assert.deepEqual(await assets.read(archived),pngBytes);assert.equal((await db.listImageTextRecords()).length,2);
    db.deleteImageTextRecord=originalDelete;await deleteImageTextWithAssets(db,assets,d.id);await assert.rejects(assets.read(a));await assert.rejects(assets.read(b));await assert.rejects(assets.read(archived));
    assert.deepEqual(await assets.read(shared),pngBytes);assert.equal((await db.listImageTextRecords()).length,1);assert.deepEqual(await db.pendingImageTextCleanup(),[]);
  }finally{db.close();assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});}
});
test('清理中断时存在记录则恢复图片，记录已删除则清理暂存文件',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'image-cleanup-'));const assets=new ImageTextAssets(root);const db=new LocalSQLiteManager(root);
  try{const d=imageTextFixture();const id=await assets.save(pngBytes);d.pages[0].assetId=id;await db.saveImageTextRecord(d);
    await db.queueImageTextCleanup(d.id,[id]);const original=path.join(assets.directory,id),staged=path.join(assets.directory,id+'--deleted--'+d.id);
    await fs.rename(original,staged);await recoverImageTextCleanup(db,assets);assert.deepEqual(await assets.read(id),pngBytes);
    await db.queueImageTextCleanup(d.id,[id]);await fs.rename(original,staged);await db.deleteImageTextRecord(d.id);await recoverImageTextCleanup(db,assets);await assert.rejects(fs.access(staged));
  }finally{db.close();assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});}
});
