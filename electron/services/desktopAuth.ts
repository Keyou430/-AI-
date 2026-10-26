import fs from 'node:fs';
import path from 'node:path';
import { AuthService, AuthError } from './authService';
import { RemoteAuthService } from './remoteAuthService';
import type { LocalSQLiteManager } from '../db/sqliteService';

export function createDesktopAuth(db: LocalSQLiteManager, appDirectory: string, configDirectory: string, _deviceDirectory?: string) {
  const metadata = JSON.parse(fs.readFileSync(path.join(appDirectory, 'package.json'), 'utf8'));
  if (metadata.authMode === 'remote') {
    try {
      const config = JSON.parse(fs.readFileSync(path.join(configDirectory, 'auth-config.json'), 'utf8'));
      return new RemoteAuthService(config.url);
    } catch { throw new AuthError('AUTH_CONFIG_INVALID', '员工版授权服务配置缺失或无效，请联系管理员'); }
  }
  if (metadata.authMode === 'local') return new AuthService(db);
  throw new AuthError('AUTH_CONFIG_INVALID', '账号授权模式配置缺失或无效');
}
