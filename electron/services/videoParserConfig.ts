export type VideoParserProvider = 'custom' | 'yaoan' | 'linkdigest';

export interface VideoParserOptions {
  method: 'POST' | 'GET';
  authMode: 'bearer' | 'header' | 'query' | 'none';
  apiKeyName: string;
  urlField: string;
  textPath: string;
  titlePath: string;
  timeoutSeconds: number;
}

export const DEFAULT_VIDEO_PARSER_OPTIONS: VideoParserOptions = {
  method: 'POST', authMode: 'bearer', apiKeyName: 'X-API-Key', urlField: 'url',
  textPath: '', titlePath: '', timeoutSeconds: 10,
};

export function normalizeVideoParserOptions(input?: unknown): VideoParserOptions {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
    throw new Error('内容提取接口配置无效');
  }
  const options = { ...DEFAULT_VIDEO_PARSER_OPTIONS, ...input as Partial<VideoParserOptions> };
  if (!['POST', 'GET'].includes(options.method) || !['bearer', 'header', 'query', 'none'].includes(options.authMode)) {
    throw new Error('请选择有效的请求方式和鉴权方式');
  }
  const validName = (name: unknown): name is string => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name);
  if (!validName(options.urlField) || !validName(options.apiKeyName)) throw new Error('链接参数名和密钥参数名格式无效');
  if (options.authMode === 'query' && options.apiKeyName === options.urlField) throw new Error('密钥参数名不能与链接参数名相同');
  if (options.authMode === 'header' && ['content-type', 'host', 'content-length', 'connection', 'transfer-encoding'].includes(options.apiKeyName.toLowerCase())) {
    throw new Error('请选择用于鉴权的请求头名称');
  }
  for (const field of [options.textPath, options.titlePath]) {
    if (typeof field !== 'string' || field.length > 256 || (field && !/^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/.test(field)) ||
        field.split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) {
      throw new Error('返回字段请使用点分隔路径，例如 data.audio_text 或 data.items.0.text');
    }
  }
  if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 1 || options.timeoutSeconds > 300) {
    throw new Error('请求超时须为 1 到 300 秒之间的整数');
  }
  return { method: options.method, authMode: options.authMode, apiKeyName: options.apiKeyName, urlField: options.urlField,
    textPath: options.textPath, titlePath: options.titlePath, timeoutSeconds: options.timeoutSeconds };
}
