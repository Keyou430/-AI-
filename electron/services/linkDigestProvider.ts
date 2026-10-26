import { setTimeout as delay } from 'node:timers/promises';
import type { ParsedVideoData, VideoParseResponse, VideoPlatform } from './videoParser';

const origin = 'https://linkdigest.dev';
const timeoutMs = 150000; // 小于现有授权任务的 180 秒上限。

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];

export interface LinkDigestDetails {
  provider: 'linkdigest';
  transcriptSegments: Array<{ t: number | null; text: string }>;
  onScreen: Array<{ t: number | null; text: string }>;
  images: Array<{ description: string; ocr: string }>;
  ocrText: string[];
  keyPoints: string[];
  warnings: string[];
  transcriptSource?: string;
  credits?: number;
  cached?: boolean;
  coverage?: { secondsTranscribed?: number; durationSeconds?: number; imagesRead?: number; imagesTotal?: number };
}

export function parseLinkDigestResponse(payload: unknown, platform: VideoPlatform, url: string): VideoParseResponse {
  const raw = object(payload);
  if (!raw || raw.pending === true || raw.error || raw.error_code || raw.success === false || raw.platform !== platform ||
      (!Array.isArray(raw.transcript) && !Array.isArray(raw.images) && typeof raw.caption !== 'string')) {
    return { success: false, errorCode: 'API_ERROR', errorMessage: 'LinkDigest 未返回有效的提取结果，请检查任务或链接。' };
  }
  const warnings: string[] = [];
  const segments = (value: unknown) => Array.isArray(value) ? value.flatMap(item => {
    const entry = object(item);
    if (!entry || !text(entry.text).trim()) return [];
    return [{ t: number(entry.t) ?? null, text: text(entry.text) }];
  }) : [];
  const transcriptSegments = segments(raw.transcript);
  if (Array.isArray(raw.transcript) && transcriptSegments.length !== raw.transcript.length) warnings.push('部分口播片段无有效文字，已保留其余片段，请核对漏句。');
  const images = Array.isArray(raw.images) ? raw.images.map(item => {
    const entry = object(item);
    return { description: text(entry?.description), ocr: text(entry?.ocr) };
  }) : [];
  if (images.some(item => !item.description.trim() && !item.ocr.trim())) warnings.push('部分图片没有识别结果，已保留其返回位置，不能视为全部图片识别成功。');
  const receipt = object(raw.coverage);
  const coverage = receipt ? { secondsTranscribed: number(receipt.seconds_transcribed), durationSeconds: number(receipt.duration_seconds),
    imagesRead: number(receipt.images_read), imagesTotal: number(receipt.images_total) } : undefined;
  const duration = number(raw.duration_seconds) ?? coverage?.durationSeconds ?? 0;
  const readSeconds = number(raw.read_seconds);
  const partial = !!raw.partial || (readSeconds !== undefined && duration > 0 && readSeconds < duration);
  if (partial) warnings.push('该结果仅覆盖部分内容，不能视为完整原稿。');
  const imagesTotal = coverage?.imagesTotal ?? number(raw.image_count);
  const imagesRead = coverage?.imagesRead;
  if (imagesTotal !== undefined && ((imagesRead !== undefined && imagesRead < imagesTotal) || images.length < imagesTotal)) {
    warnings.push('图片读取数量少于原帖总数，请核对缺图与返回顺序。');
  }
  if (Array.isArray(raw.degraded) && raw.degraded.length) warnings.push('厂商报告部分提取能力降级，口播、画面或图片可能缺失，请人工核对。');
  if (strings(receipt?.not_captured).length) warnings.push('厂商注明有未读取内容，可能涉及评论、画面或其他素材；本结果不是整帖完整副本。');
  if (!receipt) warnings.push('厂商未返回覆盖凭据，无法确认提取完整性。');
  const details: LinkDigestDetails = { provider: 'linkdigest', transcriptSegments, images, onScreen: segments(raw.on_screen),
    ocrText: strings(raw.ocr_text), keyPoints: strings(raw.key_points), warnings,
    ...(typeof raw.transcript_source === 'string' ? { transcriptSource: raw.transcript_source } : {}),
    ...(number(raw.credits) !== undefined ? { credits: number(raw.credits) } : {}),
    ...(typeof raw.cached === 'boolean' ? { cached: raw.cached } : {}), ...(coverage ? { coverage } : {}) };
  const transcript = transcriptSegments.map(item => item.text).join('\n');
  const publishedText = text(raw.caption);
  const visualContent = images.some(item => item.description.trim() || item.ocr.trim()) || details.ocrText.length > 0 || details.onScreen.length > 0;
  if (!transcript.trim() && !publishedText.trim() && !visualContent) {
    return { success: false, errorCode: 'API_ERROR', errorMessage: 'LinkDigest 未读到正文、口播或图片内容；不会使用摘要冒充原稿。' };
  }
  const status = transcript.trim() ? warnings.length ? 'partial' : 'succeeded' : 'empty';
  const message = status === 'partial' ? '口播已返回，但完整性待核对，请查看提取说明。'
    : status === 'empty' ? '未返回有效口播，已保留发布文案及可用图文；可将图文素材填入编辑区后再二创。' : undefined;
  const data: ParsedVideoData = { platform, extractedUrl: url, title: text(raw.title) || publishedText.slice(0, 80) || '链接提取内容',
    author: text(raw.author) || '未知作者', durationSec: duration, transcript, publishedText,
    transcriptionStatus: status, ...(message ? { transcriptionMessage: message } : {}), extractionDetails: details,
    visualSummary: '', suggestedCameraWork: '' };
  return transcript.trim() || visualContent ? { success: true, data }
    : { success: false, data, errorCode: 'TRANSCRIPTION_FAILED', errorMessage: message };
}

function httpFailure(status: number): VideoParseResponse {
  const messages: Record<number, string> = {
    400: 'LinkDigest 不接受此链接，请复制平台分享的完整链接。',
    401: 'LinkDigest API Key 无效或已撤销，请在设置中更新。',
    402: 'LinkDigest 余额不足或本次内容超过积分上限，请检查额度及设置中的单次积分上限。',
    403: 'LinkDigest 账号或接口权限不足，请检查厂商账户。',
    422: 'LinkDigest 无法读取此链接，作品可能已删除、需要登录或被平台阻止；小红书请保留分享链接参数。',
    429: 'LinkDigest 请求过于频繁或此 Key 已达月度上限，请稍后检查；程序未自动重试。',
    503: '平台暂时拒绝 LinkDigest 自动读取。请改用厂商的本地文件上传或浏览器扩展；本程序不会绕过限制。',
  };
  return { success: false, errorCode: [402, 429].includes(status) ? 'QUOTA_EXHAUSTED' : 'API_ERROR',
    errorMessage: messages[status] || 'LinkDigest 服务暂时异常（HTTP ' + status + '），未自动重新提交提取。' };
}

export async function readLinkDigest(input: { url: string; platform: VideoPlatform; apiKey: string; maxCredits?: number },
  onError?: (error: unknown) => void, signal?: AbortSignal): Promise<VideoParseResponse> {
  signal?.throwIfAborted();
  if (!input.apiKey) return { success: false, errorCode: 'API_ERROR', errorMessage: '请先在设置中保存 LinkDigest API Key。' };
  const maxCredits = input.maxCredits ?? 5;
  if (!Number.isInteger(maxCredits) || maxCredits < 1 || maxCredits > 1000) {
    return { success: false, errorCode: 'API_ERROR', errorMessage: 'LinkDigest 单次积分上限须为 1 至 1000 的整数。' };
  }
  const requestSignal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  const headers = { Authorization: 'Bearer ' + input.apiKey, 'Content-Type': 'application/json' };
  let jobId: string | undefined;
  try {
    let response = await fetch(origin + '/api/v1/digest', { method: 'POST', headers, redirect: 'error', signal: requestSignal,
      body: JSON.stringify({ url: input.url, format: 'json', depth: 'full', partial_ok: false, max_credits: maxCredits }) });
    while (true) {
      if (response.status !== 200 && response.status !== 202) {
        onError?.({ name: 'APIError', status: response.status });
        return httpFailure(response.status);
      }
      const payload: unknown = await response.json();
      if (response.status === 200) return parseLinkDigestResponse(payload, input.platform, input.url);
      const pending = object(payload);
      // 不访问响应提供的 poll URL，防止将密钥发往第三方地址；任务编号不得变更。
      if (!pending || pending.pending !== true || (pending.jobId !== undefined &&
          (typeof pending.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(pending.jobId) || (jobId && pending.jobId !== jobId)))) {
        return { success: false, errorCode: 'API_ERROR', errorMessage: 'LinkDigest 异步任务信息无效，未自动重新提交。' };
      }
      jobId = typeof pending.jobId === 'string' ? pending.jobId : jobId;
      if (!jobId) return { success: false, errorCode: 'API_ERROR', errorMessage: 'LinkDigest 未返回任务编号，未自动重新提交。' };
      await delay(1000, undefined, { signal: requestSignal });
      response = await fetch(origin + '/api/v1/digest/' + encodeURIComponent(jobId) + '?wait=20',
        { method: 'GET', headers, redirect: 'error', signal: requestSignal });
    }
  } catch {
    signal?.throwIfAborted();
    const timedOut = requestSignal.aborted;
    onError?.({ name: timedOut ? 'TimeoutError' : 'LinkDigestRequestError' });
    return { success: false, errorCode: 'API_ERROR', errorMessage: timedOut
      ? 'LinkDigest 提取等待超时，厂商任务可能仍在处理；未自动重新提交，再次提取可能重复计费。'
      : 'LinkDigest 请求失败或响应格式无效。未自动重新提交；任务可能已受理，请勿连续点击提取。' };
  }
}
