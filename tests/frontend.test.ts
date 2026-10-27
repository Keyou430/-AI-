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

test('浏览器环境不因旧仿真配置返回示例数据', async () => {
  Object.assign(globalThis, {window:{}});
  const settings = {...useAppStore.getState().settings,enableMockFallback:true};
  assert.equal((await parseVideoLinkClient('https://v.douyin.com/demo/', settings)).success,false);
  const result = await streamGenerateScriptClient({ settings,systemPrompt:'',userPrompt:'',targetDurationSec:18,userCameraWork:'',onChunk:()=>{} });
  assert.equal(result.success,false);
});


test('历史保存失败时抛出主进程返回的错误', async () => {
  Object.assign(globalThis, {window:{electronAPI:{saveHistoryToDB:async () => ({success:false,error:'磁盘空间不足'})}}});
  const { saveHistoryRecordToSQLite } = await import('../src/services/ipcClient');
  const record = {id:'failed-save'} as import('../src/types').HistoryRecord;
  await assert.rejects(saveHistoryRecordToSQLite(record), /磁盘空间不足/);
});


function historyRecord(id: string): import('../src/types').HistoryRecord {
  const state = useAppStore.getInitialState();
  const video: import('../src/types').ParsedVideoInfo = {
    platform: 'douyin', extractedUrl: 'https://v.douyin.com/test/', title: id,
    author: '测试作者', durationSec: 18, transcript: '测试原始口播',
    visualSummary: '测试画面描述', suggestedCameraWork: '近景',
  };
  return {id,platform:video.platform,sourceUrl:video.extractedUrl,title:id,
    createdAt:new Date().toISOString(),durationSec:state.targetDurationSec,
    userCameraWork:state.userCameraWork,originalTranscript:video.transcript,
    visualSummary:video.visualSummary,rawGeneratedScript:state.streamingScriptText,
    parsedStructure:state.parsedScript!,refinementHistory:[],conversationMessages:[]};
}

test('保存期间切换历史后仍保存原记录，并保留当前工作台与选中项', async () => {
  const original = historyRecord('original');
  const other = historyRecord('other');
  let resolveSave!: (value: {success:boolean;record:import('../src/types').HistoryRecord}) => void;
  let submitted: import('../src/types').HistoryRecord | undefined;
  Object.assign(globalThis, {window:{electronAPI:{
    saveHistoryToDB: (record: import('../src/types').HistoryRecord) => {
      submitted = record;
      return new Promise(resolve => { resolveSave = resolve; });
    },
    listHistoryFromDB: async () => ({success:true,records:[original,other]}),
    getDatabaseInfo: async () => ({success:true,info:{engine:'sqlite3-wasm',dbPath:'test',totalCount:2,dbSizeBytes:0}}),
  }}});
  useAppStore.getState().loadHistoryToWorkbench(original);
  const revision = useAppStore.getState().workbenchRevision;
  const pendingSave = useAppStore.getState().saveGeneratedHistory(original, revision);
  useAppStore.getState().loadHistoryToWorkbench(other);
  useAppStore.getState().setSelectedHistoryId(other.id);
  resolveSave({success:true,record:original});
  await pendingSave;
  assert.deepEqual(submitted, original);
  assert.equal(useAppStore.getState().currentEditingHistoryId, other.id);
  assert.equal(useAppStore.getState().selectedHistoryId, other.id);
  assert.equal(useAppStore.getState().streamingScriptText, other.rawGeneratedScript);
});

test('保存失败不更新当前历史 ID 或选中项', async () => {
  const original = historyRecord('existing');
  const unsaved = historyRecord('unsaved');
  Object.assign(globalThis, {window:{electronAPI:{saveHistoryToDB:async () => ({success:false,error:'写入失败'})}}});
  useAppStore.getState().loadHistoryToWorkbench(original);
  useAppStore.getState().setSelectedHistoryId(original.id);
  await assert.rejects(useAppStore.getState().saveGeneratedHistory(unsaved, useAppStore.getState().workbenchRevision), /写入失败/);
  assert.equal(useAppStore.getState().currentEditingHistoryId, original.id);
  assert.equal(useAppStore.getState().selectedHistoryId, original.id);
});


test('保存后的列表刷新不覆盖刷新期间选择的记录', async () => {
  const original = historyRecord('refresh-original');
  const other = historyRecord('refresh-other');
  let resolveList!: (value: {success:boolean;records:import('../src/types').HistoryRecord[]}) => void;
  let listStarted!: () => void;
  const started = new Promise<void>(resolve => { listStarted = resolve; });
  Object.assign(globalThis, {window:{electronAPI:{
    saveHistoryToDB: async () => ({success:true,record:original}),
    listHistoryFromDB: () => new Promise(resolve => { resolveList = resolve; listStarted(); }),
    getDatabaseInfo: async () => ({success:true,info:{engine:'sqlite3-wasm',dbPath:'test',totalCount:2,dbSizeBytes:0}}),
  }}});
  useAppStore.getState().loadHistoryToWorkbench(original);
  useAppStore.getState().setSelectedHistoryId(original.id);
  const pendingSave = useAppStore.getState().saveGeneratedHistory(original, useAppStore.getState().workbenchRevision);
  await started;
  useAppStore.getState().loadHistoryToWorkbench(other);
  useAppStore.getState().setSelectedHistoryId(other.id);
  resolveList({success:true,records:[original,other]});
  await pendingSave;
  assert.equal(useAppStore.getState().selectedHistoryId, other.id);
  assert.equal(useAppStore.getState().currentEditingHistoryId, other.id);
});


test('提取新素材解除旧历史绑定，编辑不改变原始口播且草稿可重新加载', async () => {
  const record = historyRecord('source-record');
  useAppStore.getState().loadHistoryToWorkbench(record);
  const revision = useAppStore.getState().workbenchRevision;
  const source = {platform:'douyin' as const,extractedUrl:'https://v.douyin.com/demo/',title:'素材',author:'作者',durationSec:18,
    transcript:'原始口播',publishedText:'发布文案',visualSummary:'',suggestedCameraWork:'',
    extractionDetails:{provider:'linkdigest' as const,transcriptSegments:[{t:0,text:'原始口播'}],onScreen:[],images:[{ocr:'图片文字',description:'图一'}],ocrText:[],keyPoints:[],warnings:[]}};
  useAppStore.getState().setParsedVideo(source);
  useAppStore.getState().setEditedTranscript('人工修改稿');
  assert.equal(useAppStore.getState().currentEditingHistoryId,null);
  assert.equal(useAppStore.getState().workbenchRevision, revision + 1);
  assert.equal(useAppStore.getState().streamingScriptText,'');
  assert.deepEqual(useAppStore.getState().conversationMessages,[]);
  await useAppStore.persist.rehydrate();
  assert.equal(useAppStore.getState().parsedVideo?.transcript,'原始口播');
  assert.equal(useAppStore.getState().editedTranscript,'人工修改稿');
  assert.equal(useAppStore.getState().parsedVideo?.extractionDetails?.images[0].ocr,'图片文字');
  useAppStore.getState().loadHistoryToWorkbench({...record,originalTranscript:'历史修改稿',sourceContent:source});
  assert.equal(useAppStore.getState().parsedVideo?.transcript,'原始口播');
  assert.equal(useAppStore.getState().editedTranscript,'历史修改稿');
  const { buildUserPrompt } = await import('../src/lib/promptBuilder');
  const prompt = buildUserPrompt({videoInfo:source,editedTranscript:'人工修改稿',editedVisualSummary:'',targetDurationSec:18,
    userCameraWork:'',companyBusinessProfile:'',keywords:[],knowledgeDocs:[]});
  assert.ok(prompt.includes('发布文案')); assert.ok(prompt.includes('人工修改稿')); assert.equal(prompt.includes('原始口播'),false);
});


test('历史删除失败保留记录与选择，不刷新或吞掉具体原因', async () => {
  const record = historyRecord('delete-failed');
  const other = historyRecord('delete-kept');
  let refreshes = 0;
  let submittedId = '';
  Object.assign(globalThis, {window:{electronAPI:{
    deleteHistoryFromDB: async (id: string) => { submittedId = id; return {success:false,error:'数据库暂时不可写'}; },
    listHistoryFromDB: async () => { refreshes++; return {success:true,records:[]}; },
  }}});
  useAppStore.setState({historyRecords:[record,other],selectedHistoryId:record.id});
  await assert.rejects(useAppStore.getState().deleteHistoryRecord(record.id), /数据库暂时不可写/);
  assert.equal(submittedId, record.id);
  assert.deepEqual(useAppStore.getState().historyRecords, [record,other]);
  assert.equal(useAppStore.getState().selectedHistoryId, record.id);
  assert.equal(refreshes, 0);
});

test('历史删除成功只删除指定记录，刷新后仍可查看其他记录', async () => {
  const record = historyRecord('delete-confirmed');
  const other = historyRecord('delete-survivor');
  let records = [record,other];
  Object.assign(globalThis, {window:{electronAPI:{
    deleteHistoryFromDB: async (id: string) => { records = records.filter(item => item.id !== id); return {success:true}; },
    listHistoryFromDB: async () => ({success:true,records}),
    getDatabaseInfo: async () => ({success:true,info:{engine:'sqlite3-wasm',dbPath:'test',totalCount:records.length,dbSizeBytes:0}}),
  }}});
  useAppStore.setState({historyRecords:records,selectedHistoryId:record.id});
  await useAppStore.getState().deleteHistoryRecord(record.id);
  assert.deepEqual(useAppStore.getState().historyRecords, [other]);
  assert.equal(useAppStore.getState().selectedHistoryId, other.id);
});


test('旧设置迁移和重新加载均移除仿真开关，保留业务配置', async () => {
  const options = useAppStore.persist.getOptions();
  const previous = { settings: { ...useAppStore.getInitialState().settings, enableMockFallback: true,
    companyBusinessProfile: '已保存业务', llmApiKey: 'old-secret', videoParserApiKey: 'old-video-secret' } };
  const migrated = await options.migrate!(previous, 1);
  const merged = options.merge!(migrated, useAppStore.getInitialState());
  assert.equal('enableMockFallback' in merged.settings, false);
  assert.equal(merged.settings.companyBusinessProfile, '已保存业务');
  assert.equal(merged.settings.llmApiKey, '');
  assert.equal(merged.settings.videoParserApiKey, '');
  assert.equal('enableMockFallback' in options.merge!(previous, useAppStore.getInitialState()).settings, false);
});


test('图文提取自动填入正文与图片文字，编辑和恢复保留原始素材', async () => {
  const source = {
    platform: 'xiaohongshu' as const, extractedUrl: 'https://www.xiaohongshu.com/explore/image-note',
    title: '新能源外贸', author: '作者', durationSec: 0, transcript: '', publishedText: '图文正文 #新能源[话题]#',
    transcriptionStatus: 'empty' as const, visualSummary: '', suggestedCameraWork: '',
    extractionDetails: { provider: 'linkdigest' as const, transcriptSegments: [], onScreen: [],
      images: [{ ocr: '图片中的产品与外贸知识', description: '智能图片描述' }], ocrText: ['重复汇总'],
      keyPoints: ['智能分析内容'], tags: ['新能源', '外贸'], warnings: [] },
  };
  useAppStore.getState().setParsedVideo(source);
  const originalText = useAppStore.getState().editedTranscript;
  assert.ok(originalText.includes(source.publishedText));
  assert.ok(originalText.includes('第1张图片文字：\n图片中的产品与外贸知识'));
  assert.equal(originalText.includes('智能分析'), false);
  assert.equal(useAppStore.getState().parsedVideo?.transcript, '');
  useAppStore.getState().setEditedTranscript('人工整理的图文文案');
  await useAppStore.persist.rehydrate();
  assert.equal(useAppStore.getState().editedTranscript, '人工整理的图文文案');
  useAppStore.getState().resetEditedToOriginal();
  assert.equal(useAppStore.getState().editedTranscript, originalText);
  assert.equal(useAppStore.getState().parsedVideo?.extractionDetails?.images[0].ocr, source.extractionDetails.images[0].ocr);
});
