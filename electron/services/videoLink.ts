export type VideoPlatform = 'douyin' | 'xiaohongshu';

export function extractUrlAndPlatform(rawInput: string): {
  url: string | null;
  platform: VideoPlatform | null;
} {
  if (!rawInput || !rawInput.trim()) {
    return { url: null, platform: null };
  }

  const urlRegex = /https?:\/\/[^\s，。！？、；：“”‘’（）《》【】]+/i;
  const match = rawInput.match(urlRegex);
  const candidateUrl = match ? match[0] : rawInput.trim();

  if (!/^https?:\/\//i.test(candidateUrl)) {
    return { url: null, platform: null };
  }

  let hostname: string;
  try { hostname = new URL(candidateUrl).hostname.toLowerCase(); }
  catch { return { url: null, platform: null }; }
  const matchesDomain = (domain: string) => hostname === domain || hostname.endsWith('.' + domain);
  if (['douyin.com', 'iesdouyin.com'].some(matchesDomain)) {
    return { url: candidateUrl, platform: 'douyin' };
  }
  if (['xiaohongshu.com', 'xhslink.com', 'xhslink.cn'].some(matchesDomain)) {
    return { url: candidateUrl, platform: 'xiaohongshu' };
  }

  return { url: candidateUrl, platform: null };
}

export function getVideoLinkError(rawInput: string): string | null {
  if (!rawInput.trim()) return '链接内容为空，请复制抖音或小红书的分享链接后粘贴。';
  const { url, platform } = extractUrlAndPlatform(rawInput);
  if (!url) return '未找到有效链接，请粘贴包含 http:// 或 https:// 的完整分享内容。';
  if (!platform) return '暂不支持该链接平台，目前仅支持抖音和小红书分享链接。';
  return null;
}
