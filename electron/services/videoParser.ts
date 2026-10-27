import { userFacingError } from './userFacingError';
import { extractUrlAndPlatform } from './videoLink';
import { readLinkDigest, type LinkDigestDetails } from './linkDigestProvider';
import { getYaoanVideoPreset, parseYaoanVideoResponse } from './yaoanVideoProvider';
import { normalizeVideoParserOptions, type VideoParserOptions, type VideoParserProvider } from './videoParserConfig';
/**
 * [Phase 1] 第三方短视频解析服务
 * - 通过设置页或环境变量配置第三方解析 API
 * - 支持从抖音/小红书分享口令中正则提取真实 URL 并识别所属平台
 * - 通过真实 HTTP 请求解析素材
 */

export type VideoPlatform = 'douyin' | 'xiaohongshu';

export interface VideoParseRequest {
  rawInput: string;
  apiKey?: string;
  apiEndpoint?: string;
  apiOptions?: VideoParserOptions;
  apiProvider?: VideoParserProvider;
  linkDigestMaxCredits?: number;
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
}

// 通过主进程环境变量或设置页配置，代码中不内置密钥。
export const DEFAULT_HARDCODED_VIDEO_API = {
  endpoint: process.env.VIDEO_PARSER_ENDPOINT || '',
  apiKey: process.env.VIDEO_PARSER_API_KEY || '',
};


export { extractUrlAndPlatform } from './videoLink';

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

  const preset = req.apiProvider === 'yaoan' ? getYaoanVideoPreset(platform) : undefined;
  const endpoint = preset?.endpoint || req.apiEndpoint?.trim() || DEFAULT_HARDCODED_VIDEO_API.endpoint;
  const apiKey = req.apiKey?.trim() || DEFAULT_HARDCODED_VIDEO_API.apiKey;

  if (req.apiProvider === 'linkdigest') {
    return readLinkDigest({ url, platform, apiKey: req.apiKey?.trim() || '', maxCredits: req.linkDigestMaxCredits }, onError, signal);
  }

  try {
    const options = normalizeVideoParserOptions(preset?.options || req.apiOptions);
    if (!endpoint || (options.authMode !== 'none' && !apiKey)) {
      return { success: false, errorCode: 'API_ERROR', errorMessage: '请先在系统设置中保存内容提取接口地址及所需接口密钥。' };
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
        errorMessage: `第三方解析接口返回状态码 ${response.status}：接口调用额度已耗尽或触发限流。`,
      };
    }

    if (!response.ok) {
      const message = response.status === 401 ? '接口密钥无效或已过期，请在设置页更新'
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
  } catch (err: unknown) {
    signal?.throwIfAborted();
    onError?.(err);
    return {
      success: false,
      errorCode: 'API_ERROR',
      errorMessage: userFacingError(err, '调用内容提取接口失败，请检查系统设置中的接口地址、鉴权方式和字段路径。'),
    };
  }
}
