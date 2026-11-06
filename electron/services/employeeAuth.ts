import type { AuthLifecycle } from './authError';
import { RemoteAuthService } from './remoteAuthService';
import { readAuthServerUrl } from './authServerBinding';
import type { LocalSQLiteManager } from '../db/sqliteService';
import type { RuntimeLogger } from './runtimeLogger';

// 员工构建使用独立入口，package.json 的 authMode 不参与授权决策。
export function createDesktopAuth(_db: LocalSQLiteManager, _appDirectory: string, configDirectory: string, deviceDirectory?: string,
  logger?: Pick<RuntimeLogger, 'write'>, lifecycle?: AuthLifecycle) {
  return new RemoteAuthService(readAuthServerUrl(configDirectory, deviceDirectory), 5000, false, logger, lifecycle);
}
