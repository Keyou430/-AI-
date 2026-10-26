import { setTimeout as delay } from 'node:timers/promises';
import { readLinkDigest, type LinkDigestDetails } from './linkDigestProvider';
import { getYaoanVideoPreset, parseYaoanVideoResponse } from './yaoanVideoProvider';
import { normalizeVideoParserOptions, type VideoParserOptions, type VideoParserProvider } from './videoParserConfig';
/**
 * [Phase 1] 第三方短视频解析服务
 * - 通过设置页或环境变量配置第三方解析 API
 * - 支持从抖音/小红书分享口令中正则提取真实 URL 并识别所属平台
 * - 支持真实 HTTP 请求解析与独立的示例数据模式
 */

export type VideoPlatform = 'douyin' | 'xiaohongshu';

export interface VideoParseRequest {
  rawInput: string;
  apiKey?: string;
  apiEndpoint?: string;
  apiOptions?: VideoParserOptions;
  apiProvider?: VideoParserProvider;
  linkDigestMaxCredits?: number;
  enableMockFallback?: boolean;
}

export interface ParsedVideoData {
  platform: VideoPlatform;
  extractedUrl: string;
  title: string;
  author: string;
  durationSec: number;
  transcript: string;
  publishedText?: string;
  transcriptionStatus?: 'succeeded' | 'failed' | 'empty' | 'not_video' | 'partial';
  extractionDetails?: LinkDigestDetails;
  transcriptionMessage?: string;
  visualSummary: string;
  suggestedCameraWork: string;
}

export interface VideoParseResponse {
  success: boolean;
  data?: ParsedVideoData;
  errorCode?: 'INVALID_URL' | 'UNSUPPORTED_PLATFORM' | 'QUOTA_EXHAUSTED' | 'API_ERROR' | 'TRANSCRIPTION_FAILED';
  errorMessage?: string;
  isMockData?: boolean;
}

// 通过主进程环境变量或设置页配置，代码中不内置密钥。
export const DEFAULT_HARDCODED_VIDEO_API = {
  endpoint: process.env.VIDEO_PARSER_ENDPOINT || '',
  apiKey: process.env.VIDEO_PARSER_API_KEY || '',
};


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

const MOCK_VIDEO_SAMPLES: Record<VideoPlatform, ParsedVideoData> = {
  douyin: {
    platform: 'douyin',
    extractedUrl: 'https://v.douyin.com/iY8demo9/',
    title: '早八打工人3分钟消水肿冰美式制作与桌面效率好物分享',
    author: '阿泽的效率工坊',
    durationSec: 18,
    transcript:
      '每天早上起来脸肿得像发面馒头？别再喝普通速溶了！教你一招我连喝四周的消水肿冰萃法：先往杯子里加满八分冰块，倒入零脂椰子水垫底，再把双份浓缩咖啡沿着冰块慢慢淋上去。只需三十秒，不仅口感清爽回甘，上午开会脑子瞬间清醒！',
    visualSummary:
      '清晨阳光洒进极简办公桌，博主手持玻璃杯展示冰块落杯特写，随后注入清澈椰子水与深褐色浓缩咖啡形成漂亮分层，最后博主微笑举杯饮用并进入工作状态。',
    suggestedCameraWork: '近景俯拍、特写推进、中景平视跟随',
  },
  xiaohongshu: {
    platform: 'xiaohongshu',
    extractedUrl: 'http://xhslink.com/a/9xDemo21',
    title: '小户型书房改造｜不到5平米打造高专注力极简工作角',
    author: '林木木家居笔记',
    durationSec: 20,
    transcript:
      '谁说房间小就不能拥有独立书房？只要抓住这三个核心动线，五平米角落也能变身效率天堂。第一，换掉笨重传统书桌，改用一米二悬浮升降桌释放腿部空间；第二，利用墙面洞洞板把零碎线材全部上墙；第三，加一盏高显色屏幕挂灯，晚上加班眼睛再也不酸涩。',
    visualSummary:
      '展示改造前杂乱拥挤的角落对比，随后通过升降桌升降、洞洞板收纳配件安装、暖光屏幕挂灯点亮三个连续动作展现清爽通透的桌面空间。',
    suggestedCameraWork: '广角平视横摇、近景侧面推轨、微距俯拍特写',
  },
};

export async function parseShortVideoLink(
  req: VideoParseRequest,
  onError?: (error: unknown) => void,
  signal?: AbortSignal
): Promise<VideoParseResponse> {
  signal?.throwIfAborted();
  const { url, platform } = extractUrlAndPlatform(req.rawInput);

  if (!url) {
    return {
      success: false,
      errorCode: 'INVALID_URL',
      errorMessage: '未检测到有效的视频链接，请粘贴包含 http:// 或 https:// 的抖音或小红书分享链接。',
    };
  }

  if (!platform) {
    return {
      success: false,
      errorCode: 'UNSUPPORTED_PLATFORM',
      errorMessage: '当前仅支持抖音（douyin.com）与小红书（xiaohongshu.com / xhslink.com / xhslink.cn）视频链接。',
    };
  }

  if (url.includes('quota-error') || req.apiKey === 'EXPIRED_KEY') {
    return {
      success: false,
      errorCode: 'QUOTA_EXHAUSTED',
      errorMessage: '第三方视频解析 API 额度已耗尽或密钥失效，请前往【设置页】更换有效的 API Key。',
    };
  }

  const preset = req.apiProvider === 'yaoan' ? getYaoanVideoPreset(platform) : undefined;
  const endpoint = preset?.endpoint || req.apiEndpoint?.trim() || DEFAULT_HARDCODED_VIDEO_API.endpoint;
  const apiKey = req.apiKey?.trim() || DEFAULT_HARDCODED_VIDEO_API.apiKey;

  if (!req.enableMockFallback && req.apiProvider === 'linkdigest') {
    return readLinkDigest({ url, platform, apiKey: req.apiKey?.trim() || '', maxCredits: req.linkDigestMaxCredits }, onError, signal);
  }

  // 真实模式下调用用户配置的接口。
  if (!req.enableMockFallback) {
    try {
      const options = normalizeVideoParserOptions(preset?.options || req.apiOptions);
      if (!endpoint || (options.authMode !== 'none' && !apiKey)) {
        return { success: false, errorCode: 'API_ERROR', errorMessage: '请先在系统设置中保存内容提取接口地址及所需 API Key。' };
      }
      const requestSignal = AbortSignal.any([AbortSignal.timeout(options.timeoutSeconds * 1000), ...(signal ? [signal] : [])]);
      const requestUrl = new URL(endpoint);
      if (preset) requestUrl.searchParams.set('use_own_key', 'false');
      const headers: Record<string, string> = {};
      if (options.authMode === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
      if (options.authMode === 'header') headers[options.apiKeyName] = apiKey;
      if (options.authMode === 'query') requestUrl.searchParams.set(options.apiKeyName, apiKey);
      if (options.method === 'GET') requestUrl.searchParams.set(options.urlField, url);
      else headers['Content-Type'] = 'application/json';
      const response = await fetch(requestUrl, {
        method: options.method, headers,
        ...(options.method === 'POST' ? { body: JSON.stringify({ [options.urlField]: url }) } : {}),
        signal: requestSignal,
      });

      if (response.status === 402 || response.status === 429) {
        onError?.({ name: 'APIError', status: response.status });
        return {
          success: false,
          errorCode: 'QUOTA_EXHAUSTED',
          errorMessage: `第三方解析接口返回状态码 ${response.status}：API 调用额度已耗尽或触发限流。`,
        };
      }

      if (!response.ok) {
        const message = response.status === 401 ? 'API Key 无效或已过期，请在设置页更新'
          : response.status === 403 ? '厂商余额不足或未开通接口权限，请检查厂商账户' : `内容提取服务返回 HTTP ${response.status}`;
        throw Object.assign(new Error(message), { status: response.status });
      }

      const json: any = await response.json();
      if (preset) return parseYaoanVideoResponse(json, platform, url);
      if (!json || typeof json !== 'object' || json.success === false || ['401', '403'].includes(String(json.code))) {
        throw new Error('内容提取接口返回失败状态，请检查密钥、额度和请求参数');
      }
      const rawData = json.data || json;
      const readField = (fieldPath: string): unknown => fieldPath.split('.').reduce<unknown>((value, key) =>
        value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)
          ? (value as Record<string, unknown>)[key] : undefined, json);
      const transcript = options.textPath ? readField(options.textPath) : rawData.transcript || rawData.asr_text;
      if (typeof transcript !== 'string' || !transcript.trim()) {
        throw new Error('内容提取接口未返回非空文本，请在系统设置中检查返回文本字段路径');
      }

      const title = options.titlePath ? readField(options.titlePath) : rawData.title || rawData.desc;
      return {
        success: true,
        data: {
          platform,
          extractedUrl: url,
          title: typeof title === 'string' && title.trim() ? title : '短视频提取内容',
          author: rawData.author?.nickname || rawData.author || '原作者',
          durationSec: Number(rawData.duration || rawData.durationSec || 18),
          transcript,
          publishedText: typeof rawData.desc === 'string' ? rawData.desc : '',
          transcriptionStatus: 'succeeded',
          visualSummary:
            rawData.visual_summary ||
            rawData.cover_desc ||
            '（解析接口未提供画面描述，请手动补充）',
          suggestedCameraWork:
            rawData.camera_work || '近景俯拍、特写推进、中景平视跟随',
        },
      };
    } catch (err: any) {
      signal?.throwIfAborted();
      onError?.(err);
      if (!req.enableMockFallback) {
        return {
          success: false,
          errorCode: 'API_ERROR',
          errorMessage: `调用第三方解析接口失败（${err?.message || '网络异常'}）。请检查系统设置中的接口地址、鉴权方式和字段路径。`,
        };
      }
    }
  }

  // 仿真模式使用固定示例数据。
  await delay(500, undefined, { signal });
  const sample = MOCK_VIDEO_SAMPLES[platform];
  return {
    success: true,
    isMockData: true,
    data: {
      ...sample,
      extractedUrl: url,
    },
  };
}
