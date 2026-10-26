import fs from 'node:fs';
import path from 'node:path';
import { AuthError } from './authError';
import type { ProviderSettings, ProviderSettingsInput } from './providerTypes';
import { normalizeVideoParserOptions } from './videoParserConfig';

interface SecretStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

// 只向界面返回配置状态，API Key 使用操作系统安全存储加密后落盘。
export class LocalProviderService {
  private readonly file: string;
  constructor(directory: string, private readonly storage: SecretStorage) {
    this.file = path.join(directory, 'providers.encrypted');
  }
  read(): ProviderSettingsInput {
    if (!fs.existsSync(this.file)) return { llmBaseUrl: '', llmModel: '', videoParserEndpoint: '' };
    if (!this.storage.isEncryptionAvailable()) throw new AuthError('INVALID_CONFIG', '系统密钥存储不可用');
    try { return JSON.parse(this.storage.decryptString(fs.readFileSync(this.file))); }
    catch { throw new AuthError('INVALID_CONFIG', '无法读取本机接口配置，请检查当前系统用户'); }
  }
  publicSettings(): ProviderSettings {
    const config = this.read();
    return { llmBaseUrl: config.llmBaseUrl, llmModel: config.llmModel, videoParserEndpoint: config.videoParserEndpoint,
      ...(config.videoParserOptions ? { videoParserOptions: config.videoParserOptions } : {}),
      ...(config.videoParserProvider ? { videoParserProvider: config.videoParserProvider } : {}),
      ...(config.linkDigestMaxCredits !== undefined ? { linkDigestMaxCredits: config.linkDigestMaxCredits } : {}),
      llmKeyConfigured: !!config.llmApiKey, videoKeyConfigured: !!config.videoParserApiKey };
  }
  save(input: ProviderSettingsInput): ProviderSettings {
    if (!this.storage.isEncryptionAvailable()) throw new AuthError('INVALID_CONFIG', '系统密钥存储不可用，无法安全保存');
    if (!input || typeof input.llmBaseUrl !== 'string' || typeof input.videoParserEndpoint !== 'string' ||
        typeof input.llmModel !== 'string' || input.llmModel.length > 128) throw new AuthError('INVALID_CONFIG', '接口配置无效');
    for (const address of [input.llmBaseUrl, input.videoParserEndpoint]) {
      if (!address) continue;
      try { const url = new URL(address);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || address.length > 2048) throw new Error();
      } catch { throw new AuthError('INVALID_CONFIG', '接口地址须为不带凭据或查询参数的 HTTPS 地址'); }
    }
    const previous = this.read();
    const videoParserProvider = input.videoParserProvider === undefined ? previous.videoParserProvider : input.videoParserProvider;
    if (videoParserProvider !== undefined && !['custom', 'yaoan', 'linkdigest'].includes(videoParserProvider)) throw new AuthError('INVALID_CONFIG', '请选择有效的内容提取厂商');
    if (previous.videoParserApiKey && (videoParserProvider || 'custom') !== (previous.videoParserProvider || 'custom') && (typeof input.videoParserApiKey !== 'string' || !input.videoParserApiKey.trim())) {
      throw new AuthError('INVALID_CONFIG', '更换内容提取厂商时，请填写对应厂商的 API Key');
    }
    const linkDigestMaxCredits = input.linkDigestMaxCredits === undefined ? previous.linkDigestMaxCredits : input.linkDigestMaxCredits;
    if (linkDigestMaxCredits !== undefined && (!Number.isInteger(linkDigestMaxCredits) || linkDigestMaxCredits < 1 || linkDigestMaxCredits > 1000)) {
      throw new AuthError('INVALID_CONFIG', 'LinkDigest 单次积分上限须为 1 至 1000 的整数');
    }
    let videoParserOptions = previous.videoParserOptions;
    if (input.videoParserOptions !== undefined) {
      try { videoParserOptions = normalizeVideoParserOptions(input.videoParserOptions); }
      catch (error) { throw new AuthError('INVALID_CONFIG', error instanceof Error ? error.message : '内容提取接口配置无效'); }
    }
    const next: ProviderSettingsInput = { llmBaseUrl: input.llmBaseUrl, llmModel: input.llmModel,
      videoParserEndpoint: input.videoParserEndpoint, llmApiKey: previous.llmApiKey, videoParserApiKey: previous.videoParserApiKey,
      ...(videoParserOptions ? { videoParserOptions } : {}), ...(videoParserProvider ? { videoParserProvider } : {}),
      ...(linkDigestMaxCredits !== undefined ? { linkDigestMaxCredits } : {}) };
    for (const key of ['llmApiKey', 'videoParserApiKey'] as const) {
      if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key]!.length > 4096 || /[\r\n]/.test(input[key]!))) {
        throw new AuthError('INVALID_CONFIG', '密钥格式无效');
      }
      if (input[key]?.trim()) next[key] = input[key]!.trim();
    }
    if ((next.llmApiKey && (!next.llmBaseUrl || !next.llmModel)) || (next.videoParserApiKey && !next.videoParserEndpoint && !['yaoan', 'linkdigest'].includes(next.videoParserProvider || 'custom'))) {
      throw new AuthError('INVALID_CONFIG', '填写密钥时须同时填写对应接口地址和模型名称');
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, this.storage.encryptString(JSON.stringify(next)), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    return this.publicSettings();
  }
}
