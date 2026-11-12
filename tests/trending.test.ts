import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHotboardResponse, getPlatformHotspots, getAllPlatformHotspots } from '../electron/services/trendingProvider';
import { parseIndustryProfile, applyHotspotRanking } from '../electron/services/trendingIpc';
import { getRealTopicUrl } from '../electron/services/trendingLinks';
import { DEFAULT_PROFILES, detectIndustryProfile, industryContext, rankHotspotsByRules, fetchTrendingHotspots } from '../src/services/trendingService';
import { buildUserPrompt } from '../src/lib/promptBuilder';
import { assertImageTextDraft, imageTextPlanningPrompt } from '../electron/services/imageTextModel';
import { TRENDING_PLATFORMS, type HotspotFetchResult, type HotspotItem, type TrendingPlatform } from '../electron/services/trendingTypes';
import type { KnowledgeDocument } from '../src/types';
import { imageTextFixture } from './helpers/imageTextFixture';

const memory = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => memory.get(k) || null,
  setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) } });
Object.assign(globalThis, { window: { localStorage: globalThis.localStorage } });
const { useAppStore } = require('../src/store/useAppStore') as typeof import('../src/store/useAppStore');
const { useImageTextStore } = require('../src/store/useImageTextStore') as typeof import('../src/store/useImageTextStore');
const { useTrendingStore } = require('../src/store/useTrendingStore') as typeof import('../src/store/useTrendingStore');
const now = Date.parse('2026-11-10T08:00:00Z');
function board(platform: TrendingPlatform, updated = now, title = '新能源汽车电池续航实测') {
  return { type: platform, update_time: new Date(updated).toISOString(), list: [{ index: 1, title, hot_value: '12345', url: getRealTopicUrl(platform, title) }] };
}
function result(platform: TrendingPlatform = 'weibo', title?: string): HotspotFetchResult {
  return parseHotboardResponse(platform, board(platform, now, title), now);
}
function reset(api: Record<string, unknown> = {}) {
  useTrendingStore.getState().resetSession();
  useTrendingStore.setState({ ...useTrendingStore.getInitialState(), profile: null, lastContextSignature: '' });
  useAppStore.setState({ ...useAppStore.getInitialState(), keywords: [], knowledgeDocs: [] });
  useImageTextStore.setState({ ...useImageTextStore.getInitialState() });
  Object.assign(globalThis, { window: { localStorage: globalThis.localStorage, electronAPI: api } });
}
function source(item: HotspotItem) {
  return { id: item.id, platform: item.platform, title: item.title, url: item.url, sourceName: item.sourceName,
    sourceUpdatedAt: item.sourceUpdatedAt, fetchedAt: item.fetchedAt, remixAngle: item.remixAngle };
}

test('热榜解析保留真实时间、原始热度和话题链接，按标题去重并保持 ID 稳定', () => {
  const value = board('zhihu'); value.list[0].url = 'https://www.zhihu.com/question/123456';
  value.list.push({ ...value.list[0], index: 2 });
  const first = parseHotboardResponse('zhihu', value, now);
  const second = parseHotboardResponse('zhihu', value, now + 1000);
  assert.equal(first.hotspots.length, 1); assert.equal(first.hotspots[0].url, value.list[0].url);
  assert.equal(first.hotspots[0].heatScore, '12345'); assert.equal(first.hotspots[0].sourceUpdatedAt, now);
  assert.equal(first.hotspots[0].id, second.hotspots[0].id); assert.equal(first.sources[0].status, 'fresh');
});
test('过期数据按来源时间标识，不用本次获取时间冒充更新', () => {
  const value = parseHotboardResponse('xiaohongshu', board('xiaohongshu', now - 14 * 86400000), now);
  assert.equal(value.sources[0].status, 'stale'); assert.equal(value.hotspots[0].sourceUpdatedAt, now - 14 * 86400000);
  assert.equal(value.hotspots[0].fetchedAt, now);
  assert.equal(value.sources[0].refreshFailed, undefined);
  assert.match(value.sources[0].message!, /上游榜单超过 24 小时未更新/);
});
test('空榜、错误平台、无效及未来更新时间不会成为有效热榜', () => {
  for (const value of [{}, { ...board('weibo'), list: [] }, board('douyin'), { ...board('weibo'), update_time: 'bad' }, board('weibo', now + 3600000)]) {
    assert.throws(() => parseHotboardResponse('weibo', value, now));
  }
});
test('平台链接保留来源原帖，拒绝站外、伪装域名及非 HTTPS 链接', () => {
  assert.equal(getRealTopicUrl('zhihu', '主题', 'https://www.zhihu.com/question/42'), 'https://www.zhihu.com/question/42');
  for (const url of ['javascript:alert(1)', 'https://www.zhihu.com.attacker.test/q', 'http://www.zhihu.com/question/42', 'https://x:pass@www.zhihu.com/q']) {
    assert.equal(getRealTopicUrl('zhihu', '主题', url), 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent('主题'));
  }
});
test('20 分钟缓存避免重复采集，强制刷新发起新请求，失败保留原时间', async t => {
  t.mock.method(Date, 'now', () => now); let calls = 0; let fail = false;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return fail ? new Response('', { status: 503 }) : Response.json(board('weibo')); });
  const first = await getPlatformHotspots('weibo', undefined, true);
  assert.equal((await getPlatformHotspots('weibo')).sources[0].cached, true); assert.equal(calls, 1);
  await getPlatformHotspots('weibo', undefined, true); assert.equal(calls, 2);
  fail = true; const stale = await getPlatformHotspots('weibo', undefined, true);
  assert.equal(stale.sources[0].status, 'stale'); assert.equal(stale.hotspots[0].fetchedAt, first.hotspots[0].fetchedAt);
  assert.equal(stale.sources[0].sourceUpdatedAt, now);
  assert.equal(stale.sources[0].refreshFailed, true);
  fail = false;
  assert.equal((await getPlatformHotspots('weibo', undefined, true)).sources[0].refreshFailed, undefined);
});
test('单平台失败保留其他平台，取消任务不返回兜底数据', async t => {
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const platform = new URL(input).searchParams.get('type') as TrendingPlatform;
    return platform === 'zhihu' ? new Response('', { status: 401 }) : Response.json(board(platform));
  });
  const all = await getAllPlatformHotspots(undefined, true);
  assert.equal(all.sources.length, TRENDING_PLATFORMS.length); assert.equal(all.sources.find(s => s.platform === 'zhihu')!.status, 'unavailable');
  assert.ok(all.hotspots.some(item => item.platform === 'douyin'));
  assert.ok(all.hotspots.some(item => item.platform === 'toutiao'));
  assert.equal(all.hotspots.some(item => item.platform === 'wechat_channels'), false);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(getAllPlatformHotspots(controller.signal, true), { name: 'AbortError' });
});
test('行业画像返回校验阻止错误类型，Markdown JSON 可正常解析', () => {
  assert.throws(() => parseIndustryProfile('{"primaryIndustry": 1}'));
  assert.throws(() => parseIndustryProfile('not json'));
  const profile = parseIndustryProfile('```json\n' + JSON.stringify({ primaryIndustry: '装修', subCategories: ['全屋定制', 2], targetAudience: '业主' }) + '\n```');
  assert.deepEqual(profile.subCategories, ['全屋定制']); assert.equal(profile.analysisMethod, 'ai');
});
test('AI 精排只修改白名单字段，无效评分保留规则结果，不新增或改写来源', () => {
  const items = result().hotspots;
  const ranked = applyHotspotRanking(JSON.stringify([{ id: items[0].id, relevanceScore: 200, remixAngle: '结合续航科普', platform: 'douyin', url: 'https://attacker.test', matchKeywords: ['续航', 3] }, { id: 'fake', relevanceScore: 99 }]), items);
  assert.equal(ranked.length, 1); assert.equal(ranked[0].relevanceScore, 100); assert.equal(ranked[0].platform, 'weibo');
  assert.equal(ranked[0].url, items[0].url); assert.deepEqual(ranked[0].matchKeywords, ['续航']);
  assert.equal(applyHotspotRanking('[{"id":"' + items[0].id + '","relevanceScore":1e400,"remixAngle":"错误"}]', items)[0].analysisMethod, 'rules');
  assert.throws(() => applyHotspotRanking('{}', items));
});
test('仅已启用资料与业务词参与画像，禁止词用于过滤，不作为行业卖点', async () => {
  reset();
  const docs = [{ id: 'doc', enabled: true, name: '装修工艺', fullContent: '全屋定制验收' + '字'.repeat(3000) },
    { id: 'disabled', enabled: false, name: '汽车电池', fullContent: '新能源' }] as KnowledgeDocument[];
  const keywords = [{ id: 'a', text: '全屋定制', category: 'brand' as const }, { id: 'b', text: '新能源汽车', category: 'forbidden' as const }];
  const context = industryContext(docs, keywords);
  assert.equal(context.docSnippets.length, 1); assert.ok(context.docSnippets[0].length <= 400); assert.deepEqual(context.keywords, ['全屋定制']);
  const profile = await detectIndustryProfile(docs, keywords);
  assert.equal(profile.analysisMethod, 'rules'); assert.ok(profile.primaryIndustry.includes('装修'));
  const selected = rankHotspotsByRules(result().hotspots, DEFAULT_PROFILES.new_energy, ['电池']);
  assert.equal(selected.length, 0);
});
test('预设行业相关标题达到推荐门槛，泛化词和无关娱乐不进入推荐', () => {
  const examples: Array<[string, string, string]> = [
    ['new_energy', '车企发布纯电新车与快充方案', '明星演唱会官宣'],
    ['decoration', '装修材料环保等级怎么选', '明星定制演唱会服装'],
    ['tech', 'AI芯片发布提升手机性能', 'Thai旅游攻略更新'],
    ['health', '营养搭配与睡眠质量如何改善', '明星演唱会官宣'],
    ['beauty', '防晒霜选购与敏感肌护理', '赛事精华回顾'],
    ['food', '咖啡和烘焙蛋糕进入秋季上新', '菜鸟发布物流新方案'],
    ['general', '品牌营销案例与用户增长方法', '明星演唱会官宣'],
  ];
  for (const [key, relevant, unrelated] of examples) {
    assert.ok(rankHotspotsByRules(result('weibo', relevant).hotspots, DEFAULT_PROFILES[key])[0].relevanceScore >= 60, key + ' 应推荐：' + relevant);
    assert.ok(rankHotspotsByRules(result('weibo', unrelated).hotspots, DEFAULT_PROFILES[key])[0].relevanceScore < 60, key + ' 不应推荐：' + unrelated);
  }
});
test('预设行业以主行业为准，通用痛点不会单独成为行业依据', () => {
  const profile = { ...DEFAULT_PROFILES.decoration, subCategories: [...DEFAULT_PROFILES.decoration.subCategories, '动力电池'] };
  assert.ok(rankHotspotsByRules(result('weibo', '新能源汽车发布新车').hotspots, profile)[0].relevanceScore < 60);
  assert.ok(rankHotspotsByRules(result('weibo', '选择困难症如何挑选演唱会座位').hotspots, DEFAULT_PROFILES.tech)[0].relevanceScore < 60);
});
test('预设行业精排只接收行业相关且未过期的候选，无关热点不能被模型抬分', async () => {
  const relevant = result('weibo', '装修材料环保等级怎么选');
  const unrelated = result('weibo', '明星演唱会官宣').hotspots[0];
  const stale = result('xiaohongshu', '全屋定制安装验收'); stale.sources[0].status = 'stale';
  let submitted: string[] = [];
  reset({ fetchHotspots: async () => ({ success: true, hotspots: [...relevant.hotspots, unrelated, ...stale.hotspots], sources: [...relevant.sources, ...stale.sources] }),
    rankHotspotsWithLLM: async ({ candidates }: { candidates: HotspotItem[] }) => { submitted = candidates.map(item => item.id); return { success: true, ranked: candidates.map(item => ({ ...item, relevanceScore: 100, analysisMethod: 'ai' })) }; } });
  const ranked = await fetchTrendingHotspots(DEFAULT_PROFILES.decoration);
  assert.deepEqual(submitted, [relevant.hotspots[0].id]);
  assert.ok(ranked.hotspots.find(item => item.id === unrelated.id)!.relevanceScore < 60);
  assert.equal(ranked.hotspots.find(item => item.id === stale.hotspots[0].id)!.analysisMethod, 'rules');
  assert.equal(ranked.hotspots.length, 3);
});
test('预设行业没有合格候选时跳过模型精排，保留完整原榜供浏览', async () => {
  let ranks = 0;
  reset({ fetchHotspots: async () => ({ success: true, ...result('weibo', '明星演唱会官宣') }),
    rankHotspotsWithLLM: async () => { ranks++; throw new Error('不应提交'); } });
  const ranked = await fetchTrendingHotspots(DEFAULT_PROFILES.decoration);
  assert.equal(ranks, 0); assert.equal(ranked.hotspots.length, 1); assert.ok(ranked.hotspots[0].relevanceScore < 60);
});
test('预设行业选择后进入行业推荐，并清除旧搜索及高契合筛选', () => {
  reset(); useTrendingStore.setState({ activeFilterTab: 'weibo', searchQuery: '旧关键词', onlyHighMatch: true });
  try {
    useTrendingStore.getState().selectProfileTemplate('decoration');
    assert.equal(useTrendingStore.getState().activeFilterTab, 'recommended');
    assert.equal(useTrendingStore.getState().searchQuery, ''); assert.equal(useTrendingStore.getState().onlyHighMatch, false);
  } finally { useTrendingStore.getState().resetSession(); }
});
test('切换行业预设强制获取新榜单，并以新预设标签替换旧标签', async () => {
  const forces: boolean[] = [];
  reset({ fetchHotspots: async ({ force }: { force: boolean }) => {
    forces.push(force); return { success: true, ...result('weibo', '全屋定制安装验收') };
  } });
  try {
    useTrendingStore.getState().selectProfileTemplate('new_energy');
    await new Promise(resolve => setTimeout(resolve, 350));
    useTrendingStore.getState().addCategoryTag('自定义旧标签');
    useTrendingStore.getState().selectProfileTemplate('decoration');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.deepEqual(forces, [true, true]);
    assert.deepEqual(useTrendingStore.getState().profile!.subCategories, DEFAULT_PROFILES.decoration.subCategories);
    assert.ok(!useTrendingStore.getState().profile!.subCategories.includes('自定义旧标签'));
    assert.ok(useTrendingStore.getState().hotspots[0].isHighMatch);
    const saved = JSON.parse(memory.get('video-remix-trending-v1')!);
    assert.equal(saved.state.profile.primaryIndustry, DEFAULT_PROFILES.decoration.primaryIndustry);
  } finally { useTrendingStore.getState().resetSession(); }
});
test('已保存的预设行业首次进入时显示行业推荐，再次进入保留用户筛选', async () => {
  reset({ fetchHotspots: async () => ({ success: true, ...result('weibo', '全屋定制安装验收') }) });
  useTrendingStore.setState({ profile: DEFAULT_PROFILES.decoration });
  await useTrendingStore.getState().init(); assert.equal(useTrendingStore.getState().activeFilterTab, 'recommended');
  useTrendingStore.getState().setFilterTab('all'); await useTrendingStore.getState().init();
  assert.equal(useTrendingStore.getState().activeFilterTab, 'all');
});
test('无资料时浏览原始榜单，初始化合并并发请求且不重新加载知识库', async () => {
  let reads = 0; let fetches = 0;
  reset({ listKnowledgeDocsFromDB: async () => { reads++; return { success: true, docs: [] }; },
    fetchHotspots: async () => { fetches++; return { success: true, ...result() }; } });
  await Promise.all([useTrendingStore.getState().init(), useTrendingStore.getState().init()]);
  await useTrendingStore.getState().init();
  assert.equal(reads, 0); assert.equal(fetches, 1); assert.equal(useTrendingStore.getState().profile, null);
});
test('旧请求不能覆盖新行业，也不会在响应过期后提交 AI 精排', async () => {
  const pending: Array<(value: unknown) => void> = []; let ranks = 0;
  reset({ fetchHotspots: () => new Promise(resolve => pending.push(resolve)), rankHotspotsWithLLM: async ({ candidates }: any) => { ranks++; return { success: true, ranked: candidates }; } });
  useTrendingStore.setState({ profile: DEFAULT_PROFILES.new_energy });
  const first = useTrendingStore.getState().refresh();
  useTrendingStore.setState({ profile: DEFAULT_PROFILES.decoration });
  const second = useTrendingStore.getState().refresh();
  pending[1]({ success: true, ...result('weibo', '全屋定制验收') }); await second;
  pending[0]({ success: true, ...result('weibo', '新能源汽车电池') }); await first;
  assert.equal(useTrendingStore.getState().hotspots[0].title, '全屋定制验收'); assert.equal(ranks, 1);
});
test('退出期间完成的请求不能恢复热点数据，鉴权错误不静默降级', async () => {
  let resolve!: (value: unknown) => void;
  reset({ fetchHotspots: () => new Promise(r => { resolve = r; }) });
  const pending = useTrendingStore.getState().refresh(); useTrendingStore.getState().resetSession();
  resolve({ success: true, ...result() }); await pending;
  assert.equal(useTrendingStore.getState().hotspots.length, 0);
  reset({ fetchHotspots: async () => ({ success: false, errorCode: 'AUTH_REQUIRED', error: '请重新登录' }) });
  await useTrendingStore.getState().refresh(); assert.equal(useTrendingStore.getState().error, '请重新登录');
});
test('缺少模型时保留真实榜单及规则排序，手动行业和标签持久化', async () => {
  reset({ fetchHotspots: async () => ({ success: true, ...result() }) });
  useTrendingStore.setState({ profile: DEFAULT_PROFILES.new_energy });
  await useTrendingStore.getState().refresh();
  assert.ok(useTrendingStore.getState().hotspots[0].isHighMatch); assert.match(useTrendingStore.getState().analysisNotice!, /规则排序/);
  useTrendingStore.getState().addCategoryTag('设备选型');
  assert.equal(useTrendingStore.getState().profile!.isAutoDetected, false);
  const saved = JSON.parse(memory.get('video-remix-trending-v1')!);
  assert.ok(saved.state.profile.subCategories.includes('设备选型'));
  useTrendingStore.getState().resetSession();
});
test('热点转视频前保护已有人工稿，取消保留原稿，确认后清除旧上下文并保留真实来源', async () => {
  reset(); useTrendingStore.setState({ profile: structuredClone(DEFAULT_PROFILES.new_energy) }); const item = result('weibo').hotspots[0];
  useAppStore.setState({ editedTranscript: '未保存旧稿', streamingScriptText: '旧脚本', currentEditingHistoryId: 'old', conversationMessages: [{ role: 'user', content: '旧上下文' }] });
  useTrendingStore.getState().transferToWorkbench(item);
  assert.equal(useAppStore.getState().editedTranscript, '未保存旧稿'); assert.ok(useTrendingStore.getState().pendingTransfer);
  useTrendingStore.getState().cancelTransfer(); assert.equal(useAppStore.getState().editedTranscript, '未保存旧稿');
  useTrendingStore.getState().transferToWorkbench(item); await useTrendingStore.getState().confirmTransfer();
  const app = useAppStore.getState();
  const profile = useTrendingStore.getState().profile!;
  assert.deepEqual(app.parsedVideo!.sourceHotspot!.industryProfile, profile);
  assert.notEqual(app.parsedVideo!.sourceHotspot!.industryProfile, profile);
  assert.equal(app.parsedVideo!.platform, 'weibo'); assert.equal(app.parsedVideo!.sourceHotspot!.title, item.title);
  assert.equal(app.currentEditingHistoryId, null); assert.deepEqual(app.conversationMessages, []); assert.equal(app.streamingScriptText, '');
  assert.equal(app.isGeneratingScript, false); assert.equal(app.linkInput, '');
  const prompt = buildUserPrompt({ videoInfo: app.parsedVideo!, editedTranscript: app.editedTranscript, editedVisualSummary: '',
    targetDurationSec: 18, userCameraWork: '', companyBusinessProfile: '', keywords: [], knowledgeDocs: [] });
  assert.match(prompt, /来源平台：微博/); assert.match(prompt, /来源类型：热点话题/);
  assert.match(prompt, /共同机制→行业标签→用户价值/); assert.ok(prompt.includes(JSON.stringify(profile)));
  assert.doesNotMatch(prompt, /精品冷萃咖啡液/);
});
test('热点转图文的保存失败保留旧稿，确认后只启动策划，来源允许微博且可保存', async () => {
  let plans = 0; let images = 0; let failSave = true;
  reset({ saveImageTextHistory: async (draft: any) => failSave ? { success: false, error: '磁盘空间不足' } : { success: true, data: draft },
    planImageText: async ({ draft }: any) => { plans++; return { success: true, data: { ...imageTextFixture(), id: draft.id, source: draft.source, confirmed: false } }; },
    generateImageText: async () => { images++; return { success: true }; } });
  useTrendingStore.setState({ profile: structuredClone(DEFAULT_PROFILES.new_energy) });
  const old = imageTextFixture(); useImageTextStore.setState({ draft: old, savedDraftKey: null });
  useTrendingStore.getState().transferToImageText(result().hotspots[0]);
  await useTrendingStore.getState().confirmTransfer(true);
  assert.equal(useImageTextStore.getState().draft!.id, old.id); assert.match(useTrendingStore.getState().error!, /磁盘/); assert.equal(plans, 0);
  failSave = false; await useTrendingStore.getState().confirmTransfer();
  const deadline = Date.now() + 3000;
  while (useImageTextStore.getState().taskId) { if (Date.now() > deadline) throw new Error('热点图文策划未完成'); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(plans, 1); assert.equal(images, 0);
  const draft = useImageTextStore.getState().draft!;
  assert.equal(draft.source.platform, 'weibo'); assert.equal(draft.source.sourceHotspot!.platform, 'weibo'); assertImageTextDraft(draft);
  assert.deepEqual(draft.source.sourceHotspot!.industryProfile, useTrendingStore.getState().profile);
  const prompt = imageTextPlanningPrompt(draft, []);
  assert.match(prompt.system, /共同机制→行业标签→用户价值/); assert.match(prompt.system, /associationError/);
  assert.deepEqual(JSON.parse(prompt.user).source.sourceHotspot.industryProfile, useTrendingStore.getState().profile);
});
test('目标工作台任务执行时拒绝热点覆盖并给出错误', () => {
  reset(); useAppStore.setState({ isGeneratingScript: true, editedTranscript: '执行中' });
  useTrendingStore.getState().transferToWorkbench(result().hotspots[0]);
  assert.equal(useAppStore.getState().editedTranscript, '执行中'); assert.match(useTrendingStore.getState().error!, /正在处理/);
  useImageTextStore.setState({ taskId: 'running' }); useTrendingStore.getState().transferToImageText(result().hotspots[0]);
  assert.match(useTrendingStore.getState().error!, /图文任务/); assert.equal(useTrendingStore.getState().pendingTransfer, null);
});

test('今日头条保留来源更新时间、真实话题链接，空热度显示未提供', () => {
  const value = board('toutiao');
  value.list[0].url = 'https://www.toutiao.com/trending/7706652717610962495/';
  value.list[0].hot_value = '';
  const parsed = parseHotboardResponse('toutiao', value, now);
  assert.equal(parsed.hotspots[0].platform, 'toutiao');
  assert.equal(parsed.hotspots[0].url, value.list[0].url);
  assert.equal(parsed.hotspots[0].heatScore, '未提供');
  assert.equal(parsed.hotspots[0].sourceUpdatedAt, now);
  assert.equal(parsed.sources[0].status, 'fresh');
  const fallback = 'https://so.toutiao.com/search?keyword=' + encodeURIComponent('主题');
  for (const url of ['https://toutiao.com.attacker.test/', 'http://www.toutiao.com/', 'https://user:pass@www.toutiao.com/']) {
    assert.equal(getRealTopicUrl('toutiao', '主题', url), fallback);
  }
});
test('视频号未接入时返回明确不可用状态，普通及强制刷新不请求错误平台或伪造时间', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('不应请求'); });
  for (const force of [false, true]) {
    const value = await getPlatformHotspots('wechat_channels', undefined, force);
    assert.deepEqual(value.hotspots, []);
    assert.equal(value.sources[0].status, 'unavailable');
    assert.equal(value.sources[0].count, 0);
    assert.equal(value.sources[0].sourceUpdatedAt, undefined);
    assert.match(value.sources[0].message!, /不支持视频号热榜/);
  }
  assert.equal(calls, 0);
  assert.equal(getRealTopicUrl('wechat_channels', '主题'), '');
  assert.equal(getRealTopicUrl('wechat_channels', '主题', 'https://mp.weixin.qq.com/s/test'), '');
});
