import { generateImageTextImage } from './imageGenerationService';
import type { ImageTextAssets } from './imageTextAssets';
import type { ImageTextDraft } from './imageTextTypes';
export { ImageGenerationError as AgnesImageError } from './imageGenerationService';

// 保留旧 Agnes 调用入口；新的图文流程使用通用图片生成服务。
export async function generateAgnesImage(input: { draft: ImageTextDraft; pageId: string; usePreviousImage?: boolean },
  config: { agnesApiKey?: string; agnesModel?: string }, assets: ImageTextAssets,
  signal: AbortSignal, request: typeof fetch = globalThis.fetch) {
  return generateImageTextImage(input, config, assets, signal, request);
}
