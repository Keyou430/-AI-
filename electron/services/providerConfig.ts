import type { ImageProtocol, ProviderModule, ProviderSettingsInput } from './providerTypes';

export const IMAGE_PRESETS = {
  agnes: { imageProtocol: 'agnes', imageEndpoint: 'https://apihub.agnes-ai.com/v1/images/generations', imageModel: 'agnes-image-2.5-flash' },
  seedream: { imageProtocol: 'seedream', imageEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations', imageModel: 'doubao-seedream-5-0-pro-260628' },
  glm: { imageProtocol: 'glm', imageEndpoint: 'https://open.bigmodel.cn/api/paas/v4/images/generations', imageModel: 'glm-image' },
  sub2api: { imageProtocol: 'sub2api', imageEndpoint: 'https://www.sevnx.lol/v1/images/generations', imageModel: 'gpt-image-2' },
} as const;
export const DEEPSEEK_PRESET = { llmBaseUrl: 'https://api.deepseek.com', llmModel: 'deepseek-flash' };
export const PROVIDER_MODULE_FIELDS: Record<ProviderModule, readonly (keyof ProviderSettingsInput)[]> = {
  llm: ['llmBaseUrl', 'llmModel', 'llmApiKey'],
  extraction: ['videoParserEndpoint', 'videoParserApiKey', 'videoParserProvider', 'videoParserOptions', 'linkDigestMaxCredits'],
  image: ['imageProtocol', 'imageEndpoint', 'imageModel', 'imageApiKey'],
};
export function imageEndpointUrl(address: string): URL {
  try {
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || address.length > 2048) throw new Error();
    return url;
  } catch { throw new Error('图片生成接口地址须为 HTTPS 地址，且不能包含用户名、密码、查询参数或片段'); }
}
export function imageConfig(input: Partial<ProviderSettingsInput>) {
  const protocol: ImageProtocol = input.imageProtocol || 'agnes';
  const preset = IMAGE_PRESETS[protocol];
  if (!preset) throw new Error('请选择有效的图片生成协议');
  return { imageProtocol: protocol, imageEndpoint: input.imageEndpoint ?? preset.imageEndpoint,
    imageModel: input.imageModel ?? (protocol === 'agnes' ? input.agnesModel : undefined) ?? preset.imageModel,
    imageApiKey: input.imageApiKey ?? (protocol === 'agnes' ? input.agnesApiKey : undefined) };
}
