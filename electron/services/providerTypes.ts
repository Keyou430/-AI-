import type { VideoParserOptions, VideoParserProvider } from './videoParserConfig';

export interface ProviderSettings {
  llmBaseUrl: string;
  llmModel: string;
  videoParserEndpoint: string;
  videoParserOptions?: VideoParserOptions;
  videoParserProvider?: VideoParserProvider;
  linkDigestMaxCredits?: number;
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
  llmApiKey?: string;
  videoParserApiKey?: string;
}
