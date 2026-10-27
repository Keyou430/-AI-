import fs from 'node:fs';
import path from 'node:path';
import { AuthError } from './authError';
import { RemoteAuthService } from './remoteAuthService';
import type { LocalSQLiteManager } from '../db/sqliteService';
import type { RuntimeLogger } from './runtimeLogger';

// 员工构建使用独立入口，package.json 的 authMode 不参与授权决策。
export function createDesktopAuth(_db: LocalSQLiteManager, _appDirectory: string, configDirectory: string, _deviceDirectory?: string,
  logger?: Pick<RuntimeLogger, 'write'>) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(configDirectory, 'auth-config.json'), 'utf8'));
    return new RemoteAuthService(config.url, 5000, false, logger);
  } catch { throw new AuthError('AUTH_CONFIG_INVALID', '员工版授权服务配置缺失或无效，请联系管理员'); }
}
