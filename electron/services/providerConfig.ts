import type { ImageProtocol, ProviderModule, ProviderSettingsInput } from './providerTypes';

export const IMAGE_PRESETS = {
  agnes: { imageProtocol: 'agnes', imageEndpoint: 'https://apihub.agnes-ai.com/v1/images/generations', imageModel: 'agnes-image-2.5-flash' },
  seedream: { imageProtocol: 'seedream', imageEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations', imageModel: 'doubao-seedream-5-0-pro-260628' },
} as const;
export const DEEPSEEK_PRESET = { llmBaseUrl: 'https://api.deepseek.com', llmModel: 'deepseek-flash' };
export const PROVIDER_MODULE_FIELDS: Record<ProviderModule, readonly (keyof ProviderSettingsInput)[]> = {
  llm: ['llmBaseUrl', 'llmModel', 'llmApiKey'],
  extraction: ['videoParserEndpoint', 'videoParserApiKey', 'videoParserProvider', 'videoParserOptions', 'linkDigestMaxCredits'],
  image: ['imageProtocol', 'imageEndpoint', 'imageModel', 'imageApiKey'],
};
export function imageConfig(input: Partial<ProviderSettingsInput>) {
  const protocol: ImageProtocol = input.imageProtocol || 'agnes';
  const preset = IMAGE_PRESETS[protocol];
  if (!preset) throw new Error('请选择有效的图片生成协议');
  return { imageProtocol: protocol, imageEndpoint: input.imageEndpoint ?? preset.imageEndpoint,
    imageModel: input.imageModel ?? (protocol === 'agnes' ? input.agnesModel : undefined) ?? preset.imageModel,
    imageApiKey: input.imageApiKey ?? (protocol === 'agnes' ? input.agnesApiKey : undefined) };
}
