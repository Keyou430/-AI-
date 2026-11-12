import { createHash } from 'node:crypto';
import { getRealTopicUrl } from './trendingLinks';
import { TRENDING_PLATFORMS, type HotspotFetchResult, type HotspotItem, type TrendingPlatform } from './trendingTypes';

const CACHE_TTL_MS = 20 * 60 * 1000;
const SOURCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SOURCE_NAME = 'UApi 聚合热榜';
const cache = new Map<TrendingPlatform, { result: HotspotFetchResult; savedAt: number }>();

export function parseHotboardResponse(platform: TrendingPlatform, value: unknown, fetchedAt: number): HotspotFetchResult {
  const data = value as { type?: unknown; update_time?: unknown; list?: unknown };
  const updatedAt = typeof data?.update_time === 'string' ? Date.parse(data.update_time) : NaN;
  if (data?.type !== platform || !Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > fetchedAt + 300000 || !Array.isArray(data.list)) {
    throw new Error('热榜数据格式或更新时间无效。');
  }
  const titles = new Set<string>();
  const hotspots: HotspotItem[] = [];
  for (const entry of data.list.slice(0, 100)) {
    if (!entry || typeof entry.title !== 'string') continue;
    const title = entry.title.trim().slice(0, 500);
    if (!title || titles.has(title)) continue;
    titles.add(title);
    const tag = entry.extra?.type;
    hotspots.push({
      id: platform + '_' + createHash('sha256').update(title).digest('hex').slice(0, 16),
      platform, title, rank: Number.isInteger(entry.index) && entry.index > 0 ? entry.index : hotspots.length + 1,
      heatScore: typeof entry.hot_value === 'string' || typeof entry.hot_value === 'number' ? String(entry.hot_value).trim().slice(0, 80) || '未提供' : '未提供',
      url: getRealTopicUrl(platform, title, typeof entry.url === 'string' ? entry.url : undefined),
      ...(tag === '热' || tag === '新' || tag === '爆' || tag === '上升' ? { categoryTag: tag } : {}),
      sourceName: SOURCE_NAME, sourceUpdatedAt: updatedAt, fetchedAt,
      relevanceScore: 0, matchKeywords: [], remixAngle: '', isHighMatch: false, analysisMethod: 'rules',
    });
  }
  if (!hotspots.length) throw new Error('数据源暂未返回有效话题。');
  const stale = fetchedAt - updatedAt > SOURCE_MAX_AGE_MS;
  return { hotspots, sources: [{ platform, sourceName: SOURCE_NAME, sourceUpdatedAt: updatedAt, fetchedAt,
    status: stale ? 'stale' : 'fresh', cached: false, count: hotspots.length,
    ...(stale ? { message: '上游榜单超过 24 小时未更新，刷新仍可能返回旧数据；暂不参与行业推荐。' } : {}) }] };
}

export async function getPlatformHotspots(platform: TrendingPlatform, signal?: AbortSignal, force = false): Promise<HotspotFetchResult> {
  signal?.throwIfAborted();
  if (platform === 'wechat_channels') {
    return { hotspots: [], sources: [{ platform, sourceName: '视频号数据源待接入', status: 'unavailable', cached: false, count: 0,
      message: '当前数据源不支持视频号热榜，尚未接入可用的视频号榜单服务。' }] };
  }
  const previous = cache.get(platform);
  if (!force && previous && Date.now() - previous.savedAt < CACHE_TTL_MS) {
    return { hotspots: previous.result.hotspots, sources: previous.result.sources.map(source => ({ ...source, cached: true,
      ...(source.sourceUpdatedAt && Date.now() - source.sourceUpdatedAt > SOURCE_MAX_AGE_MS ? { status: 'stale' as const, message: '上游榜单超过 24 小时未更新，刷新仍可能返回旧数据；暂不参与行业推荐。' } : {}) })) };
  }
  try {
    const response = await fetch(`https://uapis.cn/api/v1/misc/hotboard?type=${platform}`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`数据源返回 HTTP ${response.status}。`);
    const result = parseHotboardResponse(platform, await response.json(), Date.now());
    signal?.throwIfAborted();
    cache.set(platform, { result, savedAt: Date.now() });
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    const message = error instanceof Error && error.message.startsWith('数据源') ? error.message : '暂时无法获取该平台热榜，请稍后刷新。';
    if (previous) {
      const result: HotspotFetchResult = { hotspots: previous.result.hotspots, sources: previous.result.sources.map(source => ({ ...source,
        status: 'stale', cached: true, refreshFailed: true, message: message + ' 当前保留上次成功获取的数据。' })) };
      cache.set(platform, { result, savedAt: previous.savedAt });
      return result;
    }
    return { hotspots: [], sources: [{ platform, sourceName: SOURCE_NAME, status: 'unavailable', cached: false, count: 0, message }] };
  }
}

export async function getAllPlatformHotspots(signal?: AbortSignal, force = false): Promise<HotspotFetchResult> {
  const results = await Promise.all(TRENDING_PLATFORMS.map(platform => getPlatformHotspots(platform, signal, force)));
  signal?.throwIfAborted();
  return { hotspots: results.flatMap(result => result.hotspots), sources: results.flatMap(result => result.sources) };
}
