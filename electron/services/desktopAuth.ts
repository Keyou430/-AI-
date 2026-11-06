import type { AuthLifecycle } from './authError';
import fs from 'node:fs';
import path from 'node:path';
import { AuthService, AuthError } from './authService';
import { RemoteAuthService } from './remoteAuthService';
import { readAuthServerUrl } from './authServerBinding';
import type { LocalSQLiteManager } from '../db/sqliteService';
import type { RuntimeLogger } from './runtimeLogger';

export function createDesktopAuth(db: LocalSQLiteManager, appDirectory: string, configDirectory: string, deviceDirectory?: string,
  logger?: Pick<RuntimeLogger, 'write'>, lifecycle?: AuthLifecycle) {
  const metadata = JSON.parse(fs.readFileSync(path.join(appDirectory, 'package.json'), 'utf8'));
  if (metadata.authMode === 'remote') {
    return new RemoteAuthService(readAuthServerUrl(configDirectory, deviceDirectory), 5000, false, logger, lifecycle);
  }
  if (metadata.authMode === 'local') return new AuthService(db, lifecycle);
  throw new AuthError('AUTH_CONFIG_INVALID', '账号授权模式配置缺失或无效');
}
