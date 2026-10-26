import assert from 'node:assert/strict';
import { test } from 'node:test';

const storageKey = 'video-remix-ai-full-v3-storage';
const memory = new Map([[storageKey, JSON.stringify({ version: 0, state: { settings: {
  llmApiKey: 'legacy-company-llm-secret', videoParserApiKey: 'legacy-company-parser-secret', llmModel: 'retained-model',
} } })]]);
Object.assign(globalThis, { localStorage: { getItem: (key: string) => memory.get(key) || null,
  setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) } });
Object.assign(globalThis, { window: { localStorage: globalThis.localStorage } });
const { useAppStore } = require('../src/store/useAppStore') as typeof import('../src/store/useAppStore');
const { useAuthStore } = require('../src/store/useAuthStore') as typeof import('../src/store/useAuthStore');

test('旧本地密钥迁移后从状态和持久存储清除，业务配置继续保留', async () => {
  await new Promise<void>(resolve => queueMicrotask(resolve));
  assert.equal(useAppStore.getState().settings.llmApiKey, '');
  assert.equal(useAppStore.getState().settings.videoParserApiKey, '');
  assert.equal(useAppStore.getState().settings.llmModel, 'retained-model');
  assert.equal(memory.get(storageKey)!.includes('legacy-company'), false);
});

test('新输入的本机密钥不持久化，失效和退出均清空内存密钥', async () => {
  useAppStore.getState().updateSettings({ llmApiKey: 'new-llm-secret', videoParserApiKey: 'new-parser-secret' });
  assert.equal(memory.get(storageKey)!.includes('new-'), false);
  useAuthStore.getState().invalidate('账号停用');
  assert.equal(useAppStore.getState().settings.llmApiKey, '');
  assert.equal(useAppStore.getState().settings.videoParserApiKey, '');
  useAppStore.getState().updateSettings({ llmApiKey: 'logout-secret' });
  await useAuthStore.getState().signOut();
  assert.equal(useAppStore.getState().settings.llmApiKey, '');
});


test('关键词修改后重新载入保留，清空存储的新设备关键词与接口为空', async () => {
  useAppStore.getState().addKeyword('第一次填写', 'brand');
  const first = useAppStore.getState().keywords.find(keyword => keyword.text === '第一次填写')!;
  useAppStore.getState().removeKeyword(first.id);
  useAppStore.getState().addKeyword('后续修改', 'brand');
  await useAppStore.persist.rehydrate();
  assert.equal(useAppStore.getState().keywords.some(keyword => keyword.text === '后续修改'), true);
  assert.equal(useAppStore.getState().keywords.some(keyword => keyword.text === '第一次填写'), false);
  const saved = memory.get(storageKey)!;
  memory.delete(storageKey);
  delete require.cache[require.resolve('../src/store/useAppStore')];
  const fresh = (require('../src/store/useAppStore') as typeof import('../src/store/useAppStore')).useAppStore;
  assert.deepEqual(fresh.getState().keywords, []);
  assert.equal(fresh.getState().settings.companyBusinessProfile, '');
  assert.equal(fresh.getState().settings.llmApiKey, ''); assert.equal(fresh.getState().settings.videoParserApiKey, '');
  assert.equal(fresh.getState().settings.llmBaseUrl, ''); assert.equal(fresh.getState().settings.llmModel, '');
  memory.set(storageKey, saved);
});
