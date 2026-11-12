export const TRENDING_PLATFORMS = ['douyin', 'xiaohongshu', 'weibo', 'zhihu', 'toutiao', 'wechat_channels'] as const;
export type TrendingPlatform = typeof TRENDING_PLATFORMS[number];
export type PlatformType = 'all' | TrendingPlatform;
export const PLATFORM_LABELS: Record<TrendingPlatform, string> = {
  douyin: '抖音', xiaohongshu: '小红书', weibo: '微博', zhihu: '知乎', toutiao: '今日头条', wechat_channels: '视频号',
};

export interface IndustryProfile {
  primaryIndustry: string;
  subCategories: string[];
  targetAudience: string;
  corePainPoints: string[];
  suggestedAngles: string[];
  lastUpdated: number;
  isAutoDetected: boolean;
  analysisMethod?: 'ai' | 'rules';
}

export interface HotspotSource {
  id: string;
  platform: TrendingPlatform;
  title: string;
  url?: string;
  sourceName: string;
  sourceUpdatedAt: number;
  fetchedAt: number;
  remixAngle: string;
  suggestedHook?: string;
  industryProfile?: IndustryProfile;
}

export interface HotspotItem extends HotspotSource {
  rank: number;
  heatScore: string;
  categoryTag?: '爆' | '热' | '新' | '上升';
  relevanceScore: number;
  matchKeywords: string[];
  isHighMatch: boolean;
  analysisMethod: 'ai' | 'rules';
}

export interface HotspotPlatformStatus {
  platform: TrendingPlatform;
  status: 'fresh' | 'stale' | 'unavailable';
  sourceName: string;
  sourceUpdatedAt?: number;
  fetchedAt?: number;
  cached: boolean;
  refreshFailed?: boolean;
  count: number;
  message?: string;
}

export interface HotspotFetchResult {
  hotspots: HotspotItem[];
  sources: HotspotPlatformStatus[];
}

export type TrendingFilterTab = 'recommended' | PlatformType;
