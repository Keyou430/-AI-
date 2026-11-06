import { setTimeout as delay } from 'node:timers/promises';
import { MAX_IMAGE_BYTES, imageMime } from './imageTextAssets';
import { ImageGenerationError, downloadProviderImage, readImageResponse } from './imageProviderResponse';
import { imageConfig, imageEndpointUrl } from './providerConfig';
import type { ImageRatio } from './imageTextTypes';

export const SUB2API_SIZES: Record<ImageRatio, string> = {
  '1:1': '1024x1024', '3:4': '864x1152', '4:3': '1152x864', '16:9': '1536x864',
  '9:16': '864x1536', '2:3': '1024x1536', '3:2': '1536x1024', '21:9': '1792x768',
};
interface ImageTask {
  id?: unknown;
  task_id?: unknown;
  poll_url?: unknown;
  status?: unknown;
  http_status?: unknown;
  image_url?: unknown;
  result?: { data?: { url?: unknown }[] };
  error?: { type?: unknown; message?: unknown };
}
function requestError(status: number, polling: boolean): ImageGenerationError {
  const detail = status === 401 ? '密钥无效，请检查配置' : status === 403 ? '访问被拒绝，请检查权限' :
    status === 402 ? '额度不足，请检查账户余额' : status === 429 ? '请求受限，请稍后重试' :
    status === 404 && polling ? '任务不存在、已过期或不属于当前 API Key，请核对后重新生成' : '请求失败，请检查接口状态';
  const suffix = status === 401 || status === 403 ? 'AUTH' : status === 402 ? 'QUOTA' : status === 429 ? 'RATE_LIMIT' : 'REQUEST';
  return new ImageGenerationError('Sub2API ' + detail + '（HTTP ' + status + '）。', 'IMAGE_' + suffix);
}
function retryDelay(response: Response): number {
  const value = response.headers.get('Retry-After');
  const seconds = value?.trim() ? Number(value) : NaN;
  const milliseconds = Number.isFinite(seconds) ? (seconds >= 0 ? seconds * 1000 : NaN) : value ? Date.parse(value) - Date.now() : NaN;
  // 避免无效间隔造成忙轮询或超出计时器上限；等待仍受整个任务的取消/超时控制。
  return Number.isFinite(milliseconds) ? Math.max(250, Math.min(30 * 60 * 1000, milliseconds)) : 3000;
}
async function readTask(response: Response, signal: AbortSignal): Promise<ImageTask> {
  const bytes = await readImageResponse(response, 'Sub2API', 1024 * 1024, signal);
  try {
    const task = JSON.parse(bytes.toString('utf8'));
    if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error();
    return task;
  } catch { throw new Error('Sub2API 返回的任务格式无效，原有图片已保留。'); }
}
function pollingUrl(task: ImageTask, response: Response, submitUrl: URL): string {
  const id = task.task_id ?? task.id;
  const address = task.poll_url ?? response.headers.get('Location') ??
    (typeof id === 'string' && /^imgtask_[a-zA-Z0-9_-]{1,128}$/.test(id) ? '/v1/images/tasks/' + id : undefined);
  try {
    if (typeof address !== 'string' || !address || address.length > 2048) throw new Error();
    const url = new URL(address, submitUrl.origin);
    if (url.origin !== submitUrl.origin || url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
    return url.href;
  } catch { throw new Error('Sub2API 未返回有效的同源任务查询地址，已停止查询，请核对接口配置。'); }
}
function editImage(reference: string): { bytes: Buffer; mime: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(reference);
  if (!match || match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error('Sub2API 参考图须为不超过 20 MB 的 PNG、JPEG 或 WebP 图片。');
  const bytes = Buffer.from(match[2], 'base64');
  const mime = imageMime(bytes);
  if (mime !== match[1]) throw new Error('Sub2API 参考图格式与实际文件不一致，请重新上传。');
  return { bytes, mime };
}
function taskFailure(task: ImageTask, apiKey: string): ImageGenerationError {
  const status = typeof task.http_status === 'number' ? task.http_status : 500;
  const failure = requestError(status, false);
  if (task.error?.type === 'worker_interrupted') {
    return new ImageGenerationError('Sub2API 服务端生图任务已中断，请手动重试以提交新任务；原有图片已保留。', failure.code);
  }
  // 上游错误会显示在页面；隐藏凭据和 URL 查询参数，避免随历史错误信息保存。
  const message = typeof task.error?.message === 'string' ? task.error.message.split(apiKey).join('[已隐藏]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]').replace(/https?:\/\/[^\s]+/gi, '[接口地址]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300) : '';
  return new ImageGenerationError(failure.message + (message ? ' 任务执行失败：' + message : ' 任务执行失败，原有图片已保留。'), failure.code);
}
export async function requestSub2APIImage(image: ReturnType<typeof imageConfig>,
  input: { prompt: string; ratio: ImageRatio; references: string[] }, signal: AbortSignal,
  request: typeof fetch): Promise<Buffer> {
  const submitUrl = imageEndpointUrl(image.imageEndpoint);
  const operation = input.references.length ? 'edits' : 'generations';
  if (!/\/images\/(?:generations|edits)(?:\/async)?\/?$/.test(submitUrl.pathname)) {
    throw new Error('Sub2API 接口完整地址须以 /images/generations 或 /images/edits 结尾，也可使用对应的 /async 地址。');
  }
  submitUrl.pathname = submitUrl.pathname.replace(/\/images\/(?:generations|edits)(\/async)?\/?$/, '/images/' + operation + '$1');
  const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]);
  combinedSignal.throwIfAborted();
  const headers = { Authorization: 'Bearer ' + image.imageApiKey };
  const fields = { model: image.imageModel, prompt: input.prompt, n: 1, size: SUB2API_SIZES[input.ratio], quality: 'medium', async: true };
  let body: BodyInit;
  if (input.references.length) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
    input.references.forEach((reference, index) => {
      const { bytes, mime } = editImage(reference);
      form.append('image[]', new Blob([new Uint8Array(bytes)], { type: mime }), 'reference-' + (index + 1) + '.' + mime.slice(6));
    });
    body = form;
  } else {
    Object.assign(headers, { 'Content-Type': 'application/json' });
    body = JSON.stringify(fields);
  }
  // 只提交一次；轮询失败或用户取消时不自动创建新任务。
  let response = await request(submitUrl.href, { method: 'POST', redirect: 'error', headers, body, signal: combinedSignal });
  if (response.status !== 202) {
    await response.body?.cancel();
    if (!response.ok) throw requestError(response.status, false);
    throw new Error('Sub2API 未接受异步任务（应返回 HTTP 202），请核对接口是否支持异步生图。');
  }
  let task = await readTask(response, combinedSignal);
  let pollUrl: string | undefined;
  while (true) {
    combinedSignal.throwIfAborted();
    if (task.status === 'completed') {
      const resultUrl = task.result?.data?.[0]?.url;
      return downloadProviderImage(typeof resultUrl === 'string' && resultUrl ? resultUrl : task.image_url, 'Sub2API', combinedSignal, request);
    }
    if (task.status === 'failed') throw taskFailure(task, image.imageApiKey!);
    if (task.status !== 'processing') throw new Error('Sub2API 返回了不支持的任务状态，请核对接口文档；原有图片已保留。');
    pollUrl ??= pollingUrl(task, response, submitUrl);
    try { await delay(retryDelay(response), undefined, { signal: combinedSignal }); }
    catch (error) { combinedSignal.throwIfAborted(); throw error; }
    combinedSignal.throwIfAborted();
    response = await request(pollUrl, { method: 'GET', redirect: 'error', headers: { Authorization: headers.Authorization }, signal: combinedSignal });
    if (!response.ok) {
      await response.body?.cancel();
      throw requestError(response.status, true);
    }
    task = await readTask(response, combinedSignal);
  }
}
