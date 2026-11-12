import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageTextFixture } from './helpers/imageTextFixture';

const memory = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => memory.get(k) || null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) }, window: {} });
Object.assign(globalThis, { window: { localStorage: globalThis.localStorage } });
const { useAppStore } = require('../src/store/useAppStore') as typeof import('../src/store/useAppStore');
const { useImageTextStore } = require('../src/store/useImageTextStore') as typeof import('../src/store/useImageTextStore');
const info = (totalCount: number) => ({ engine: 'sqlite3-wasm' as const, totalCount, dbPath: 'fixture.sqlite', dbSizeBytes: 0 });
function install(extra: Record<string, unknown> = {}) {
  useAppStore.setState(useAppStore.getInitialState());
  useImageTextStore.setState(useImageTextStore.getInitialState());
  Object.assign(globalThis, { window: { localStorage: globalThis.localStorage, electronAPI: { listHistoryFromDB: async () => ({ success: true, records: [] }), getDatabaseInfo: async () => ({ success: true, info: info(5) }), ...extra } } });
}

test('启动即从数据库获得视频加图文总数，尚未进入图文页和平台筛选不影响总数', async () => {
  install();
  await useAppStore.getState().loadHistoryFromSQLite();
  assert.equal(useImageTextStore.getState().records.length, 0);
  assert.equal(useAppStore.getState().historyRecords.length, 0);
  assert.equal(useAppStore.getState().dbStatusInfo!.totalCount, 5);
  useAppStore.setState({ historyFilterPlatform: 'toutiao', historySearchQuery: '不存在的记录' });
  await useAppStore.getState().loadHistoryFromSQLite();
  assert.equal(useAppStore.getState().dbStatusInfo!.totalCount, 5);
});

test('图文新增、重复保存、删除后统计与实际记录数一致', async () => {
  const saved = new Map();
  install({ getDatabaseInfo: async () => ({ success: true, info: info(2 + saved.size) }), saveImageTextHistory: async (draft: any) => { saved.set(draft.id, draft); return { success: true }; }, deleteImageTextHistory: async (id: string) => { saved.delete(id); return { success: true }; } });
  useImageTextStore.getState().loadDraft(imageTextFixture());
  await useImageTextStore.getState().save(); assert.equal(useAppStore.getState().dbStatusInfo!.totalCount, 3);
  await useImageTextStore.getState().save(); assert.equal(useAppStore.getState().dbStatusInfo!.totalCount, 3);
  await useImageTextStore.getState().deleteRecord(imageTextFixture().id); assert.equal(useAppStore.getState().dbStatusInfo!.totalCount, 2);
});

test('数据库统计失败不退回浏览器空缓存并显示错误的零条', async () => {
  install({ getDatabaseInfo: async () => ({ success: false }) });
  useAppStore.setState({ dbStatusInfo: info(5) });
  await useAppStore.getState().refreshDatabaseInfo();
  assert.equal(useAppStore.getState().dbStatusInfo, null);
});

test('迟到的旧统计结果不能覆盖新统计', async () => {
  let finish!: (result: any) => void; let calls = 0;
  install({ getDatabaseInfo: async () => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : { success: true, info: info(6) } });
  const first = useAppStore.getState().refreshDatabaseInfo();
  await useAppStore.getState().refreshDatabaseInfo();
  finish({ success: true, info: info(5) }); await first;
  assert.equal(useAppStore.getState().dbStatusInfo!.totalCount, 6);
});

test('快速切换筛选时旧列表不能覆盖新筛选结果', async () => {
  let finish!: (result: any) => void; let calls = 0;
  install({ listHistoryFromDB: async () => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : { success: true, records: [] } });
  const first = useAppStore.getState().loadHistoryFromSQLite();
  useAppStore.setState({ historySearchQuery: '新搜索' }); await useAppStore.getState().loadHistoryFromSQLite();
  finish({ success: true, records: [{ id: 'old', rawGeneratedScript: '', createdAt: '2026-11-11' }] }); await first;
  assert.deepEqual(useAppStore.getState().historyRecords, []);
  assert.equal(useAppStore.getState().isLoadingHistory, false);
});
