import type { VideoParserOptions, VideoParserProvider } from './videoParserConfig';

export type ProviderModule = 'llm' | 'extraction' | 'image';
export type ImageProtocol = 'agnes' | 'seedream' | 'glm' | 'sub2api';
export interface ProviderSettings {
  llmBaseUrl: string;
  llmModel: string;
  videoParserEndpoint: string;
  videoParserOptions?: VideoParserOptions;
  videoParserProvider?: VideoParserProvider;
  linkDigestMaxCredits?: number;
  imageProtocol?: ImageProtocol;
  imageEndpoint?: string;
  imageModel?: string;
  imageKeyConfigured?: boolean;
  agnesModel?: string;
  agnesKeyConfigured?: boolean;
  llmKeyConfigured: boolean;
  videoKeyConfigured: boolean;
}
export interface ProviderSettingsInput {
  llmBaseUrl: string;
  llmModel: string;
  videoParserEndpoint: string;
  videoParserOptions?: VideoParserOptions;
  videoParserProvider?: VideoParserProvider;
  linkDigestMaxCredits?: number;
  imageProtocol?: ImageProtocol;
  imageEndpoint?: string;
  imageModel?: string;
  imageApiKey?: string;
  agnesModel?: string;
  agnesApiKey?: string;
  llmApiKey?: string;
  videoParserApiKey?: string;
}
export interface ProviderModuleInput {
  module: ProviderModule;
  config: ProviderSettingsInput;
}
export interface ProviderTestResult {
  success: boolean;
  message?: string;
  error?: string;
  preview?: string;
}
