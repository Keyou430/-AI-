import type { TrendingPlatform } from './trendingTypes';

const PLATFORM_HOSTS: Record<TrendingPlatform, string[]> = {
  douyin: ['douyin.com', 'iesdouyin.com'],
  xiaohongshu: ['xiaohongshu.com', 'xhslink.com'],
  weibo: ['weibo.com', 'weibo.cn'],
  zhihu: ['zhihu.com'],
  toutiao: ['toutiao.com'],
  wechat_channels: ['channels.weixin.qq.com'],
};

export function getRealTopicUrl(platform: TrendingPlatform, title: string, existingUrl?: string): string {
  if (existingUrl) {
    try {
      const url = new URL(existingUrl);
      if (url.protocol === 'https:' && !url.username && !url.password &&
          PLATFORM_HOSTS[platform].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) {
        return url.href;
      }
    } catch { /* 使用对应平台的话题搜索页。 */ }
  }
  const text = encodeURIComponent(title.trim());
  switch (platform) {
    case 'douyin': return `https://www.douyin.com/search/${text}`;
    case 'xiaohongshu': return `https://www.xiaohongshu.com/search_result?keyword=${text}`;
    case 'weibo': return `https://s.weibo.com/weibo?q=${text}`;
    case 'zhihu': return `https://www.zhihu.com/search?type=content&q=${text}`;
    case 'toutiao': return `https://so.toutiao.com/search?keyword=${text}`;
    case 'wechat_channels': return ''; // 尚未接入榜单，不构造视频号搜索链接。
  }
}
