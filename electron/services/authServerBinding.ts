import fs from 'node:fs';
import path from 'node:path';
import { AuthError } from './authError';
import { validateAuthUrl } from './remoteAuthService';

export function readAuthServerUrl(configDirectory: string, deviceDirectory?: string): string {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(configDirectory, 'auth-config.json'), 'utf8'));
    if (config.binding !== 'installation') return validateAuthUrl(config.url);
    if (!deviceDirectory) throw new Error('Missing device directory');
    const binding = JSON.parse(fs.readFileSync(path.join(deviceDirectory, 'auth-server-binding.json'), 'utf8'));
    if (binding.version !== 1) throw new Error('Invalid binding version');
    return validateAuthUrl(binding.url);
  } catch (error) {
    throw new AuthError('AUTH_CONFIG_INVALID', '授权服务器绑定缺失或无效，请卸载后重新安装并填写服务器地址。卸载将清除本机 API 设置。', { cause: error });
  }
}
