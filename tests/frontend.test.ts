import assert from 'node:assert/strict';
import { test } from 'node:test';

import { exportScriptFileClient, parseVideoLinkClient, streamGenerateScriptClient } from '../src/services/ipcClient';

const memory = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem:(key:string) => memory.get(key) || null,
  setItem:(key:string,value:string) => memory.set(key,value), removeItem:(key:string) => memory.delete(key) } });

Object.assign(globalThis, {window: {localStorage: globalThis.localStorage}});

const { useAppStore } = require('../src/store/useAppStore') as typeof import('../src/store/useAppStore');

test('回退版本恢复脚本和完整上下文，同时保留全部历史版本', () => {
  const first = [{role:'user' as const,content:'第一轮完整提示词'},{role:'assistant' as const,content:'第一版'}];
  useAppStore.setState({refinementHistory:[],conversationMessages:first});
  useAppStore.getState().addRefinementVersion('初始生成','第一版');
  const version = useAppStore.getState().refinementHistory[0];
  useAppStore.getState().setConversationMessages([...first,{role:'user',content:'第二轮指令'},{role:'assistant',content:'第二版'}]);
  useAppStore.getState().addRefinementVersion('第二轮指令','第二版');
  useAppStore.getState().rollbackToVersion(version);
  assert.equal(useAppStore.getState().streamingScriptText,'第一版');
  assert.equal(useAppStore.getState().refinementHistory.length,2);
  assert.deepEqual(useAppStore.getState().conversationMessages, first);
});

test('TXT 原文导出，Word 导出包含编码及转义内容', async () => {
  let payload: {content:string;format:string};
  Object.assign(globalThis, { window: { electronAPI: { exportFile: async (input: typeof payload) => { payload = input; return {success:true}; } } } });
  await exportScriptFileClient('脚本.txt','中文 <镜头> & 口播','txt');
  assert.equal(payload!.content,'中文 <镜头> & 口播');
  await exportScriptFileClient('脚本.doc','中文 <镜头> & 口播','doc');
  assert.ok(payload!.content.includes('charset="utf-8"'));
  assert.ok(payload!.content.includes('中文 &lt;镜头&gt; &amp; 口播'));
});

test('浏览器环境关闭仿真后明确阻止真实接口调用', async () => {
  Object.assign(globalThis, {window:{}});
  const settings = {...useAppStore.getState().settings,enableMockFallback:false};
  assert.equal((await parseVideoLinkClient('https://v.douyin.com/demo/', settings)).success,false);
  const result = await streamGenerateScriptClient({ settings,systemPrompt:'',userPrompt:'',targetDurationSec:18,userCameraWork:'',onChunk:()=>{} });
  assert.equal(result.success,false);
});
