import { ImageTextAssets, MAX_IMAGE_BYTES, imageMime } from './imageTextAssets';
import { assertImageTextDraft, imageTextImagePrompt, pageRenderKey } from './imageTextModel';
import { imageConfig } from './providerConfig';
import type { ProviderSettingsInput } from './providerTypes';
import type { ImageRatio, ImageTextDraft } from './imageTextTypes';

export class ImageGenerationError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'ImageGenerationError'; }
}
// Seedream 2K：使用明确像素尺寸保持整套比例，单次只请求当前一页。
export const SEEDREAM_SIZES: Record<ImageRatio, string> = {
  '1:1': '2048x2048', '3:4': '1728x2304', '4:3': '2304x1728', '16:9': '2560x1440',
  '9:16': '1440x2560', '2:3': '1664x2496', '3:2': '2496x1664', '21:9': '3024x1296',
};
export async function requestProviderImage(config: Partial<ProviderSettingsInput>,
  input: { prompt: string; ratio: ImageRatio; references: string[] }, signal: AbortSignal,
  request: typeof fetch = globalThis.fetch): Promise<Buffer> {
  const image = imageConfig(config);
  const label = image.imageProtocol === 'seedream' ? 'Seedream' : 'Agnes';
  if (!image.imageApiKey) throw new ImageGenerationError('请先在设置中保存图片生成接口密钥。', image.imageProtocol === 'agnes' ? 'AGNES_AUTH' : 'IMAGE_AUTH');
  const endpoint = new URL(image.imageEndpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('图片生成接口地址无效。');
  if (image.imageProtocol === 'seedream' && input.references.length > 10) throw new Error('Seedream 单次最多支持 10 张参考图，请减少本页参考图。');
  const body = image.imageProtocol === 'seedream'
    ? { model: image.imageModel, prompt: input.prompt, size: SEEDREAM_SIZES[input.ratio], response_format: 'b64_json', watermark: true,
      ...(input.references.length ? { image: input.references } : {}) }
    : { model: image.imageModel, prompt: input.prompt, size: '1K', ratio: input.ratio,
      ...(input.references.length ? { extra_body: { image: input.references, response_format: 'b64_json' } } : { return_base64: true }) };
  const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(170000)]);
  combinedSignal.throwIfAborted();
  const response = await request(image.imageEndpoint, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + image.imageApiKey },
    body: JSON.stringify(body), signal: combinedSignal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    const detail = response.status === 401 ? '密钥无效，请检查配置' : response.status === 403 ? '访问被拒绝，请检查权限' : response.status === 402 ? '额度不足，请检查账户余额' : response.status === 429 ? '请求受限，请稍后重试' : '请求失败，请检查额度和接口状态';
    const suffix = response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 402 ? 'QUOTA' : response.status === 429 ? 'RATE_LIMIT' : 'REQUEST';
    throw new ImageGenerationError(label + ' ' + detail + '（HTTP ' + response.status + '）。', (image.imageProtocol === 'agnes' ? 'AGNES_' : 'IMAGE_') + suffix);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(label + ' 返回了空响应。');
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_IMAGE_BYTES * 1.5) throw new Error(label + ' 图片响应过大。');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  combinedSignal.throwIfAborted();
  let encoded: unknown;
  try { encoded = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.data?.[0]?.b64_json; }
  catch { throw new Error(label + ' 返回的响应格式无效。'); }
  if (typeof encoded !== 'string' || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(label + ' 未按协议返回 Base64 图片，请核对模型与接口；原有图片已保留。');
  }
  const bytes = Buffer.from(encoded, 'base64'); imageMime(bytes);
  combinedSignal.throwIfAborted();
  return bytes;
}
export async function generateImageTextImage(input: { draft: ImageTextDraft; pageId: string; usePreviousImage?: boolean },
  config: Partial<ProviderSettingsInput>, assets: ImageTextAssets, signal: AbortSignal,
  request: typeof fetch = globalThis.fetch): Promise<{ assetId: string; renderedKey: string }> {
  assertImageTextDraft(input.draft);
  const { draft } = input;
  if (!draft.confirmed) throw new Error('请先核对图文草案并确认生成。');
  const page = draft.pages.find(p => p.id === input.pageId);
  if (!page || !page.text.trim() || !page.visual.trim()) throw new Error('请填写本页文字和画面要求。');
  const ids = [...new Set([...draft.references.filter(r => r.kind === 'style').map(r => r.id), ...page.referenceIds, ...(input.usePreviousImage && page.assetId ? [page.assetId] : [])])];
  const references = await Promise.all(ids.map(id => assets.dataURL(id)));
  const bytes = await requestProviderImage(config, { prompt: imageTextImagePrompt(draft, page), ratio: draft.ratio, references }, signal, request);
  signal.throwIfAborted();
  const assetId = await assets.save(bytes);
  if (signal.aborted) { await assets.remove(assetId); signal.throwIfAborted(); }
  return { assetId, renderedKey: pageRenderKey(draft, page) };
}
