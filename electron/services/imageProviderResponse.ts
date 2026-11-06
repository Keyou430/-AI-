import { MAX_IMAGE_BYTES, imageMime } from './imageTextAssets';

export class ImageGenerationError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'ImageGenerationError'; }
}
export async function readImageResponse(response: Response, label: string, limit: number, signal: AbortSignal): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(label + ' 返回了空响应。');
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > limit) throw new Error(label + ' 图片响应过大。');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  signal.throwIfAborted();
  return Buffer.concat(chunks);
}
export async function downloadProviderImage(address: unknown, label: string, signal: AbortSignal, request: typeof fetch): Promise<Buffer> {
  let url: URL;
  try {
    if (typeof address !== 'string') throw new Error();
    url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
  } catch { throw new Error(label + ' 未返回有效的 HTTPS 图片地址，原有图片已保留。'); }
  signal.throwIfAborted();
  // 临时图片地址可能包含签名参数；下载不携带模型 API Key，也不跟随重定向。
  const download = await request(url.href, { method: 'GET', redirect: 'error', signal });
  if (!download.ok) {
    await download.body?.cancel();
    throw new ImageGenerationError(label + ' 图片下载失败（HTTP ' + download.status + '），原有图片已保留。', 'IMAGE_REQUEST');
  }
  const bytes = await readImageResponse(download, label, MAX_IMAGE_BYTES, signal);
  imageMime(bytes);
  return bytes;
}
