import type { VideoParserOptions } from './videoParserConfig';
import type { ParsedVideoData, VideoParseResponse, VideoPlatform } from './videoParser';

// 依据厂商公开的抖音/小红书视频转文字协议；不自动重试计费请求。
export function getYaoanVideoPreset(platform: VideoPlatform): { endpoint: string; options: VideoParserOptions } {
  return {
    endpoint: platform === 'douyin' ? 'https://cyanlis.cn/api/plugins/douyin/dy_video_to_text'
      : 'https://cyanlis.cn/api/plugins/xiaohongshu/video_to_text',
    options: { method: 'GET', authMode: 'query', apiKeyName: platform === 'douyin' ? 'api_key' : 'apiKey',
      urlField: 'url', textPath: 'data.audio_text', titlePath: '', timeoutSeconds: 180 },
  };
}

export function parseYaoanVideoResponse(payload: unknown, platform: VideoPlatform, url: string): VideoParseResponse {
  const result = payload as Record<string, any> | null;
  if (!result || result.success !== true || ![0, '0'].includes(result.code) || !result.data || typeof result.data !== 'object') {
    const code = String(result?.code);
    return { success: false, errorCode: code === '429' || code === '402' ? 'QUOTA_EXHAUSTED' : 'API_ERROR',
      errorMessage: code === '401' ? 'API Key 无效或已过期，请在设置页更新。'
        : code === '403' ? '厂商余额不足或未开通接口权限，请检查厂商账户。' : '厂商未成功解析该链接，请检查作品是否公开可用后手动重试。' };
  }
  const raw = result.data;
  const publishedText = typeof raw.desc === 'string' ? raw.desc : '';
  const transcript = typeof raw.audio_text === 'string' ? raw.audio_text : '';
  const nonVideo = platform === 'xiaohongshu' && raw.type === 'normal';
  const status = nonVideo ? 'not_video' : raw.is_audio_success !== true ? 'failed' : transcript.trim() ? 'succeeded' : 'empty';
  const message = status === 'not_video' ? '该链接是图文笔记，已保留发布文案；没有视频口播可转写，可手动输入二创素材。'
    : status === 'failed' ? '视频已解析，但口播转写失败；已保留发布文案及返回的部分文字，请核对补全或手动重试。'
    : status === 'empty' ? '转写结果为空，视频可能没有可识别人声；已保留发布文案，可手动输入二创素材。' : undefined;
  const title = platform === 'xiaohongshu' && typeof raw.title === 'string' ? raw.title : publishedText.slice(0, 80);
  const author = platform === 'douyin' ? raw.nickname : raw.user?.nickname;
  // 抖音文档注明 duration 为毫秒；小红书此接口未明确时长单位，不猜测。
  const duration = platform === 'douyin' ? Number(raw.duration) / 1000 : 0;
  const data: ParsedVideoData = { platform, extractedUrl: url, title: title || '视频提取内容',
    author: typeof author === 'string' ? author : '未知作者', durationSec: Number.isFinite(duration) && duration > 0 ? duration : 0,
    publishedText, transcript, transcriptionStatus: status, ...(message ? { transcriptionMessage: message } : {}),
    visualSummary: '', suggestedCameraWork: '' };
  return status === 'succeeded' ? { success: true, data }
    : { success: false, data, errorCode: 'TRANSCRIPTION_FAILED', errorMessage: message };
}
