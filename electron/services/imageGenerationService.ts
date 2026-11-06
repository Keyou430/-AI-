import { ImageTextAssets, MAX_IMAGE_BYTES, imageMime } from './imageTextAssets';
import { ImageGenerationError, readImageResponse, downloadProviderImage } from './imageProviderResponse';
import { requestSub2APIImage } from './sub2apiImageService';
import { assertImageTextDraft, imageTextImagePrompt, pageRenderKey } from './imageTextModel';
import { imageConfig, imageEndpointUrl } from './providerConfig';
import type { ProviderSettingsInput } from './providerTypes';
import type { ImageRatio, ImageTextDraft } from './imageTextTypes';

export { ImageGenerationError } from './imageProviderResponse';
// Seedream 2K：使用明确像素尺寸保持整套比例，单次只请求当前一页。
export const SEEDREAM_SIZES: Record<ImageRatio, string> = {
  '1:1': '2048x2048', '3:4': '1728x2304', '4:3': '2304x1728', '16:9': '2560x1440',
  '9:16': '1440x2560', '2:3': '1664x2496', '3:2': '2496x1664', '21:9': '3024x1296',
};
// GLM-Image 自定义尺寸须为 32 的整数倍，并保持草案的整套比例。
export const GLM_SIZES: Record<ImageRatio, string> = {
  '1:1': '1280x1280', '3:4': '1152x1536', '4:3': '1536x1152', '16:9': '2048x1152',
  '9:16': '1152x2048', '2:3': '1024x1536', '3:2': '1536x1024', '21:9': '2016x864',
};
export async function requestProviderImage(config: Partial<ProviderSettingsInput>,
  input: { prompt: string; ratio: ImageRatio; references: string[] }, signal: AbortSignal,
  request: typeof fetch = globalThis.fetch): Promise<Buffer> {
  const image = imageConfig(config);
  const label = image.imageProtocol === 'glm' ? 'GLM' : image.imageProtocol === 'seedream' ? 'Seedream' : 'Agnes';
  imageEndpointUrl(image.imageEndpoint);
  if (!image.imageApiKey) throw new ImageGenerationError('请先在设置中保存图片生成接口密钥。', image.imageProtocol === 'agnes' ? 'AGNES_AUTH' : 'IMAGE_AUTH');
  if (image.imageProtocol === 'sub2api') return requestSub2APIImage(image, input, signal, request);
  if (image.imageProtocol === 'seedream' && input.references.length > 10) throw new Error('Seedream 单次最多支持 10 张参考图，请减少本页参考图。');
  if (image.imageProtocol === 'glm') {
    if (input.references.length) throw new ImageGenerationError('当前 GLM-Image 接入仅支持文字生图，不能附带参考图或上一版图片。请移除参考图，或切换 Agnes／Seedream。', 'IMAGE_PAGE_UNSUPPORTED');
    if (input.prompt.length > 1000) throw new ImageGenerationError('当前 GLM-Image 接入的整页生图提示词最多 1000 字符，本页为 ' + input.prompt.length + ' 字符。请精简风格、画面和文字要求，或切换 Agnes／Seedream。', 'IMAGE_PAGE_UNSUPPORTED');
  }
  const body = image.imageProtocol === 'glm'
    ? { model: image.imageModel, prompt: input.prompt, size: GLM_SIZES[input.ratio], watermark_enabled: false }
    : image.imageProtocol === 'seedream'
    ? { model: image.imageModel, prompt: input.prompt, size: SEEDREAM_SIZES[input.ratio], response_format: 'b64_json',
      ...(input.references.length ? { image: input.references } : {}) }
    : { model: image.imageModel, prompt: input.prompt, size: '1K', ratio: input.ratio,
      ...(input.references.length ? { extra_body: { image: input.references, response_format: 'b64_json' } } : { return_base64: true }) };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (image.imageApiKey) headers.Authorization = 'Bearer ' + image.imageApiKey;
  const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(170000)]);
  combinedSignal.throwIfAborted();
  const response = await request(image.imageEndpoint, {
    method: 'POST', redirect: 'error', headers, body: JSON.stringify(body), signal: combinedSignal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    const detail = response.status === 401 ? '密钥无效，请检查配置' : response.status === 403 ? '访问被拒绝，请检查权限' : response.status === 402 ? '额度不足，请检查账户余额' : response.status === 429 ? '请求受限，请稍后重试' : '请求失败，请检查额度和接口状态';
    const suffix = response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 402 ? 'QUOTA' : response.status === 429 ? 'RATE_LIMIT' : 'REQUEST';
    throw new ImageGenerationError(label + ' ' + detail + '（HTTP ' + response.status + '）。', (image.imageProtocol === 'agnes' ? 'AGNES_' : 'IMAGE_') + suffix);
  }
  const responseBytes = await readImageResponse(response, label, MAX_IMAGE_BYTES * 1.5, combinedSignal);
  let result: { url?: unknown; b64_json?: unknown } | undefined;
  try { result = JSON.parse(responseBytes.toString('utf8'))?.data?.[0]; }
  catch { throw new Error(label + ' 返回的响应格式无效。'); }
  if (image.imageProtocol === 'glm') return downloadProviderImage(result?.url, label, combinedSignal, request);
  const encoded = result?.b64_json;
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
  const styleReferences = draft.references.filter(r => r.kind === 'style');
  const previousImage = input.usePreviousImage && page.assetId;
  const ids = [...new Set([...styleReferences.map(r => r.id), ...page.referenceIds, ...(previousImage ? [previousImage] : [])])];
  if (imageConfig(config).imageProtocol === 'glm' && ids.length) {
    const sources = [
      ...(styleReferences.length ? ['整套风格参考图 ' + styleReferences.length + ' 张'] : []),
      ...(page.referenceIds.length ? ['本页绑定参考图 ' + page.referenceIds.length + ' 张'] : []),
      ...(previousImage ? ['本页上一版图片'] : []),
    ];
    const actions = [
      ...(styleReferences.length ? ['移除整套风格参考图'] : []),
      ...(page.referenceIds.length ? ['取消本页参考图绑定'] : []),
      ...(previousImage ? ['关闭“附带本页上一版图片作参考”'] : []),
    ];
    throw new ImageGenerationError('当前 GLM-Image 接入仅支持文字生图。第 ' + (draft.pages.indexOf(page) + 1) + ' 张图片包含：' + sources.join('、') + '。请' + actions.join('、') + '，或切换 Agnes／Seedream。',
      styleReferences.length ? 'IMAGE_UNSUPPORTED' : 'IMAGE_PAGE_UNSUPPORTED');
  }
  const references = await Promise.all(ids.map(id => assets.dataURL(id)));
  const bytes = await requestProviderImage(config, { prompt: imageTextImagePrompt(draft, page), ratio: draft.ratio, references }, signal, request);
  signal.throwIfAborted();
  const assetId = await assets.save(bytes);
  if (signal.aborted) { await assets.remove(assetId); signal.throwIfAborted(); }
  return { assetId, renderedKey: pageRenderKey(draft, page) };
}
