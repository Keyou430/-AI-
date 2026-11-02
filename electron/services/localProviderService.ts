import fs from 'node:fs';
import path from 'node:path';
import { AuthError } from './authError';
import type { ProviderModule, ProviderSettings, ProviderSettingsInput } from './providerTypes';
import { imageConfig, PROVIDER_MODULE_FIELDS } from './providerConfig';
import { normalizeVideoParserOptions } from './videoParserConfig';

interface SecretStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

// 只向界面返回配置状态，接口密钥 使用操作系统安全存储加密后落盘。
export class LocalProviderService {
  private readonly file: string;
  constructor(directory: string, private readonly storage: SecretStorage) {
    this.file = path.join(directory, 'providers.encrypted');
  }
  read(): ProviderSettingsInput {
    if (!fs.existsSync(this.file)) return { llmBaseUrl: '', llmModel: '', videoParserEndpoint: '' };
    if (!this.storage.isEncryptionAvailable()) throw new AuthError('INVALID_CONFIG', '系统密钥存储不可用');
    try {
      const stored = JSON.parse(this.storage.decryptString(fs.readFileSync(this.file)));
      // 旧预设忽略 endpoint（可能残留上一家厂商地址）；迁移时保持该行为。
      const legacyPreset = !stored.imageProtocol && ['linkdigest', 'yaoan'].includes(stored.videoParserProvider);
      return { ...stored, ...imageConfig(stored), ...(legacyPreset ? { videoParserEndpoint: '' } : {}) };
    }
    catch { throw new AuthError('INVALID_CONFIG', '无法读取本机接口配置，请检查当前系统用户'); }
  }
  publicSettings(): ProviderSettings {
    const config = this.read();
    return { llmBaseUrl: config.llmBaseUrl, llmModel: config.llmModel, videoParserEndpoint: config.videoParserEndpoint,
      ...(config.videoParserOptions ? { videoParserOptions: config.videoParserOptions } : {}),
      ...(config.videoParserProvider ? { videoParserProvider: config.videoParserProvider } : {}),
      ...(config.linkDigestMaxCredits !== undefined ? { linkDigestMaxCredits: config.linkDigestMaxCredits } : {}),
      ...(() => { const image = imageConfig(config); return { imageProtocol: image.imageProtocol, imageEndpoint: image.imageEndpoint, imageModel: image.imageModel, imageKeyConfigured: !!image.imageApiKey }; })(),
      agnesModel: config.agnesModel || 'agnes-image-2.5-flash', agnesKeyConfigured: !!config.agnesApiKey,
      llmKeyConfigured: !!config.llmApiKey, videoKeyConfigured: !!config.videoParserApiKey };
  }
  reset(): ProviderSettings {
    // 清空入口不能依赖旧文件可解密，也不需要重新加密。
    fs.rmSync(this.file + '.tmp', { force: true });
    fs.rmSync(this.file, { force: true });
    return this.publicSettings();
  }
  prepareModule(module: ProviderModule, input: ProviderSettingsInput): ProviderSettingsInput {
    if (!Object.prototype.hasOwnProperty.call(PROVIDER_MODULE_FIELDS, module) || !input || typeof input !== 'object') {
      throw new AuthError('INVALID_CONFIG', '接口模块无效');
    }
    const secretField = module === 'llm' ? 'llmApiKey' : module === 'image' ? 'imageApiKey' : 'videoParserApiKey';
    const patch: Partial<ProviderSettingsInput> = { [secretField]: '' };
    for (const field of PROVIDER_MODULE_FIELDS[module]) {
      if (Object.prototype.hasOwnProperty.call(input, field)) Object.assign(patch, { [field]: input[field] });
    }
    return this.prepare({ ...this.read(), ...patch });
  }
  saveModule(module: ProviderModule, input: ProviderSettingsInput): ProviderSettings {
    return this.persist(this.prepareModule(module, input));
  }
  save(input: ProviderSettingsInput): ProviderSettings { return this.persist(this.prepare(input)); }
  private prepare(input: ProviderSettingsInput): ProviderSettingsInput {
    if (!this.storage.isEncryptionAvailable()) throw new AuthError('INVALID_CONFIG', '系统密钥存储不可用，无法安全保存');
    if (!input || typeof input.llmBaseUrl !== 'string' || typeof input.videoParserEndpoint !== 'string' ||
        typeof input.llmModel !== 'string' || input.llmModel.length > 128) throw new AuthError('INVALID_CONFIG', '接口配置无效');
    for (const [label, address] of [['模型接口地址', input.llmBaseUrl], ['内容提取接口地址', input.videoParserEndpoint]]) {
      if (!address) continue;
      try { const url = new URL(address);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || address.length > 2048) throw new Error();
      } catch { throw new AuthError('INVALID_CONFIG', label + '须为 HTTPS 地址，且不能包含用户名、密码、查询参数或片段'); }
    }
    for (const key of ['llmApiKey', 'videoParserApiKey', 'agnesApiKey', 'imageApiKey'] as const) {
      if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key]!.length > 4096 || /[\r\n]/.test(input[key]!))) {
        throw new AuthError('INVALID_CONFIG', (key === 'agnesApiKey' || key === 'imageApiKey' ? '图片生成接口密钥' : key === 'llmApiKey' ? '模型接口密钥' : '内容提取接口密钥') + '格式无效：不能包含换行，长度不能超过 4096 字符');
      }
    }
    const previous = this.read();
    const changedOrigin = (before?: string, after?: string) => !!before && !!after && new URL(before).origin !== new URL(after).origin;
    if (previous.llmApiKey && changedOrigin(previous.llmBaseUrl, input.llmBaseUrl) && !input.llmApiKey?.trim()) {
      throw new AuthError('INVALID_CONFIG', '更换文本模型服务商时，请填写对应服务商的接口密钥');
    }
    const videoParserProvider = input.videoParserProvider === undefined ? previous.videoParserProvider : input.videoParserProvider;
    if (videoParserProvider !== undefined && !['custom', 'yaoan', 'linkdigest'].includes(videoParserProvider)) throw new AuthError('INVALID_CONFIG', '请选择有效的内容提取厂商');
    const noVideoKey = (videoParserProvider || 'custom') === 'custom' && (input.videoParserOptions ?? previous.videoParserOptions)?.authMode === 'none';
    if (!noVideoKey && previous.videoParserApiKey && (videoParserProvider || 'custom') !== (previous.videoParserProvider || 'custom') && (typeof input.videoParserApiKey !== 'string' || !input.videoParserApiKey.trim())) {
      throw new AuthError('INVALID_CONFIG', '更换内容提取厂商时，请填写对应厂商的 接口密钥');
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
    if (input.imageProtocol !== undefined && !['agnes', 'seedream'].includes(input.imageProtocol)) throw new AuthError('INVALID_CONFIG', '请选择有效的图片生成协议');
    const legacyImage = input.imageProtocol === undefined && !!input.agnesApiKey?.trim();
    const image = imageConfig({ ...previous, ...input, ...(legacyImage ? { imageProtocol: 'agnes', imageEndpoint: undefined, imageModel: input.agnesModel, imageApiKey: input.agnesApiKey } : {}) });
    try { const url = new URL(image.imageEndpoint);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || image.imageEndpoint.length > 2048) throw new Error();
    } catch { throw new AuthError('INVALID_CONFIG', '图片生成接口地址须为 HTTPS 地址，且不能包含用户名、密码、查询参数或片段'); }
    if (typeof image.imageModel !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(image.imageModel)) throw new AuthError('INVALID_CONFIG', '图片生成模型名称无效');
    const previousImage = imageConfig(previous);
    if (previousImage.imageApiKey && (image.imageProtocol !== previousImage.imageProtocol || changedOrigin(previousImage.imageEndpoint, image.imageEndpoint)) && !input.imageApiKey?.trim() && !legacyImage) {
      throw new AuthError('INVALID_CONFIG', '更换图片生成服务商时，请填写对应服务商的接口密钥');
    }
    const extractionAddress = (provider: ProviderSettingsInput['videoParserProvider'], endpoint: string) => endpoint || (provider === 'linkdigest' ? 'https://linkdigest.dev' : provider === 'yaoan' ? 'https://cyanlis.cn' : '');
    if (!noVideoKey && previous.videoParserApiKey && changedOrigin(extractionAddress(previous.videoParserProvider, previous.videoParserEndpoint), extractionAddress(videoParserProvider, input.videoParserEndpoint)) && !input.videoParserApiKey?.trim()) {
      throw new AuthError('INVALID_CONFIG', '更换内容提取服务商时，请填写对应服务商的接口密钥');
    }
    const agnesModel = input.agnesModel ?? previous.agnesModel ?? 'agnes-image-2.5-flash';
    if (typeof agnesModel !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(agnesModel)) throw new AuthError('INVALID_CONFIG', 'Agnes 模型名称无效');
    const next: ProviderSettingsInput = { llmBaseUrl: input.llmBaseUrl, llmModel: input.llmModel,
      ...image, imageApiKey: previousImage.imageApiKey, agnesModel, agnesApiKey: previous.agnesApiKey,
      videoParserEndpoint: input.videoParserEndpoint, llmApiKey: previous.llmApiKey, videoParserApiKey: previous.videoParserApiKey,
      ...(videoParserOptions ? { videoParserOptions } : {}), ...(videoParserProvider ? { videoParserProvider } : {}),
      ...(linkDigestMaxCredits !== undefined ? { linkDigestMaxCredits } : {}) };
    for (const key of ['llmApiKey', 'videoParserApiKey', 'agnesApiKey', 'imageApiKey'] as const) {
      if (input[key]?.trim()) next[key] = input[key]!.trim();
    }
    if (noVideoKey) delete next.videoParserApiKey;
    if ((next.llmApiKey && (!next.llmBaseUrl || !next.llmModel)) || (next.videoParserApiKey && !next.videoParserEndpoint && !['yaoan', 'linkdigest'].includes(next.videoParserProvider || 'custom'))) {
      throw new AuthError('INVALID_CONFIG', next.llmApiKey && (!next.llmBaseUrl || !next.llmModel)
        ? '模型配置不完整：填写模型密钥时，须同时填写模型接口地址和模型名称'
        : '内容提取配置不完整：使用自定义厂商时，须填写内容提取接口完整地址');
    }
    if (legacyImage) next.imageApiKey = next.agnesApiKey;
    if (next.imageProtocol === 'agnes') { next.agnesApiKey = next.imageApiKey; next.agnesModel = next.imageModel; }
    return next;
  }
  private persist(next: ProviderSettingsInput): ProviderSettings {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, this.storage.encryptString(JSON.stringify(next)), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    return this.publicSettings();
  }
}
