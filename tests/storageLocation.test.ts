import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StorageLocationService } from '../electron/services/storageLocation';
import { LocalSQLiteManager } from '../electron/db/sqliteService';

async function withDirectories(run: (source: string, target: string) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-storage-test-'));
  const source = path.join(directory, 'original');
  const target = path.join(directory, 'new');
  await fs.mkdir(source);
  await fs.mkdir(target);
  try {
    await run(source, target);
  } finally {
    assert.equal(path.dirname(directory), os.tmpdir());
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('存储地址重启后迁移完整数据库，保留原文件与设备配置', async () => {
  await withDirectories(async (source, target) => {
    const original = new LocalSQLiteManager(source);
    await original.ensureInitialized();
    const records = await original.listRecords();
    await original.upsertKnowledgeDoc({
      id: 'knowledge',
      name: '业务资料',
      filePath: '',
      fileType: 'txt',
      sizeBytes: 6,
      uploadedAt: '',
      contentSnippet: '知识库内容',
      fullContent: '知识库内容',
      charCount: 5,
      enabled: true,
    });
    const location = new StorageLocationService(source);
    assert.deepEqual(location.schedule(target), {
      directory: source,
      pendingDirectory: await fs.realpath(target),
    });
    assert.equal(
      (await original.getDatabaseInfo()).dbPath,
      path.join(source, 'video-remix-history.sqlite')
    );
    original.close();
    await fs.writeFile(path.join(source, 'provider-settings.json'), 'device-settings-stay');
    const sourceData = await fs.readFile(path.join(source, 'video-remix-history.sqlite'));
    const restarted = new StorageLocationService(source);
    assert.equal(restarted.activatePending(), await fs.realpath(target));
    assert.deepEqual(
      await fs.readFile(path.join(target, 'video-remix-history.sqlite')),
      sourceData
    );
    assert.deepEqual(
      await fs.readFile(path.join(source, 'video-remix-history.sqlite')),
      sourceData
    );
    await assert.rejects(fs.access(path.join(target, 'provider-settings.json')));
    const migrated = new LocalSQLiteManager(target);
    try {
      assert.deepEqual(
        (await migrated.listRecords()).map((record) => record.id),
        records.map((record) => record.id)
      );
      assert.equal((await migrated.listKnowledgeDocs())[0].fullContent, '知识库内容');
    } finally {
      migrated.close();
    }
    assert.equal(new StorageLocationService(source).get().pendingDirectory, undefined);
    assert.equal(new StorageLocationService(source).get().directory, await fs.realpath(target));
  });
});

test('已有数据库不覆盖，重启前目标被占用则继续使用原存储', async () => {
  await withDirectories(async (source, target) => {
    await fs.writeFile(path.join(source, 'video-remix-history.sqlite'), 'original-data');
    const location = new StorageLocationService(source);
    location.schedule(target);
    await fs.writeFile(path.join(target, 'video-remix-history.sqlite'), 'existing-data');
    assert.throws(() => location.schedule(target), /已有应用数据库/);
    const restarted = new StorageLocationService(source);
    assert.equal(restarted.activatePending(), source);
    assert.match(restarted.get().migrationError!, /已有应用数据库/);
    assert.equal(
      await fs.readFile(path.join(target, 'video-remix-history.sqlite'), 'utf8'),
      'existing-data'
    );
    assert.equal(
      await fs.readFile(path.join(source, 'video-remix-history.sqlite'), 'utf8'),
      'original-data'
    );
    assert.equal(restarted.schedule(source).pendingDirectory, undefined);
  });
});

test('迁移携带未合并的事务文件，目标目录丢失时保持原数据', async () => {
  await withDirectories(async (source, target) => {
    await fs.writeFile(path.join(source, 'video-remix-history.sqlite'), 'db');
    await fs.writeFile(path.join(source, 'video-remix-history.sqlite-wal'), 'pending-transaction');
    const location = new StorageLocationService(source);
    location.schedule(target);
    assert.equal(new StorageLocationService(source).activatePending(), await fs.realpath(target));
    assert.equal(
      await fs.readFile(path.join(target, 'video-remix-history.sqlite-wal'), 'utf8'),
      'pending-transaction'
    );
  });
  await withDirectories(async (source, target) => {
    await fs.writeFile(path.join(source, 'video-remix-history.sqlite'), 'db');
    const location = new StorageLocationService(source);
    location.schedule(target);
    await fs.rmdir(target);
    const restarted = new StorageLocationService(source);
    assert.equal(restarted.activatePending(), source);
    assert.ok(restarted.get().migrationError);
    assert.equal(await fs.readFile(path.join(source, 'video-remix-history.sqlite'), 'utf8'), 'db');
  });
});
