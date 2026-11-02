import fs from 'node:fs/promises';
import path from 'node:path';
import type { LocalSQLiteManager } from '../db/sqliteService';
import type { ImageTextDraft } from './imageTextTypes';
import { ImageTextAssets } from './imageTextAssets';
export function imageTextAssetIds(draft: ImageTextDraft): string[] {
  return [...new Set([...draft.references.map(r => r.id), ...(draft.archivedReferences || []).map(r => r.id), ...draft.pages.flatMap(p => p.assetId ? [p.assetId] : []), ...(draft.versions || []).map(v => v.assetId)])];
}
function locations(assets: ImageTextAssets, recordId: string, assetId: string) {
  if (![recordId,assetId].every(id => /^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw new Error('素材清理标识无效。');
  return { original: path.join(assets.directory,assetId), staged: path.join(assets.directory,assetId + '--deleted--' + recordId) };
}
async function exists(file: string) { try { await fs.lstat(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
export async function imageTextDeletionInfo(db: LocalSQLiteManager, assets: ImageTextAssets, id: string) {
  const records = await db.listImageTextRecords(); const draft = records.find(d => d.id === id);
  if (!draft) throw new Error('图文历史不存在。');
  const otherIds = new Set(records.filter(d => d.id !== id).flatMap(imageTextAssetIds));
  const ids = imageTextAssetIds(draft).filter(assetId => !otherIds.has(assetId));
  let bytes = 0; let count = 0;
  for (const assetId of ids) { const file = locations(assets,id,assetId).original; if (await exists(file)) { bytes += (await fs.stat(file)).size; count++; } }
  return { ids, count, bytes };
}
/** 先将图片改名暂存；失败恢复。数据库删除后清理暂存文件；清理队列保证中断后可恢复。 */
export async function deleteImageTextWithAssets(db: LocalSQLiteManager, assets: ImageTextAssets, id: string, onCleanupError: (error: unknown) => void = () => {}) {
  const info = await imageTextDeletionInfo(db,assets,id);
  await db.queueImageTextCleanup(id,info.ids);
  const moved: string[] = [];
  try {
    for (const assetId of info.ids) {
      const paths = locations(assets,id,assetId);
      if (!await exists(paths.original)) continue;
      await fs.rename(paths.original,paths.staged); moved.push(assetId);
    }
    await db.deleteImageTextRecord(id);
  } catch (error) {
    for (const assetId of moved.reverse()) { const p = locations(assets,id,assetId); await fs.rename(p.staged,p.original); }
    await db.completeImageTextCleanup(id); throw error;
  }
  // 删除失败的文件仍有数据库清理队列索引，下次启动重试，不作为无记录孤立文件遗留。
  await recoverImageTextCleanup(db,assets).catch(onCleanupError);
}
export async function recoverImageTextCleanup(db: LocalSQLiteManager, assets: ImageTextAssets) {
  const liveIds = new Set((await db.listImageTextRecords()).map(d => d.id));
  for (const entry of await db.pendingImageTextCleanup()) {
    for (const assetId of entry.assetIds) {
      const p = locations(assets,entry.id,assetId);
      if (liveIds.has(entry.id)) { if (await exists(p.staged) && !await exists(p.original)) await fs.rename(p.staged,p.original); }
      else if (await exists(p.staged)) await fs.unlink(p.staged);
    }
    await db.completeImageTextCleanup(entry.id);
  }
}
