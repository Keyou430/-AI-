import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AuthError, type ApiResetUser, type AuthLifecycle } from './authError';

type ResetRecord = { version: number; cleared: boolean };

// 只记录管理员停用的处理进度；API 配置仍由整台设备共用。
export class ProviderResetService implements AuthLifecycle {
  private readonly file: string;
  constructor(directory: string, private readonly reset: () => unknown) {
    this.file = path.join(directory, 'provider-reset-versions.json');
  }

  signedIn(user: ApiResetUser, authority: string): void { this.apply(user, authority, false); }
  disabled(user: ApiResetUser, authority: string): void { this.apply(user, authority, true); }

  private apply(user: ApiResetUser, authority: string, disabled: boolean): void {
    if (user.role !== 'member') return;
    const version = user.apiResetVersion ?? 0;
    if (!Number.isSafeInteger(version) || version < 0) throw new AuthError('AUTH_UNAVAILABLE', '授权服务返回无效停用版本');
    try {
      let records: Record<string, ResetRecord> = {};
      try { records = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!records || typeof records !== 'object' || Array.isArray(records) ||
          Object.values(records).some(value => !value || !Number.isSafeInteger(value.version) || value.version < 0 || typeof value.cleared !== 'boolean')) {
        throw new Error('Invalid API reset progress');
      }
      const key = createHash('sha256').update(JSON.stringify([authority, user.id])).digest('hex');
      const previous = records[key];
      // 首次登录只建立基线，防止同设备切换到其他账号时误清配置。
      const shouldReset = previous ? version > previous.version || (disabled && version === previous.version && !previous.cleared) : disabled;
      if (shouldReset) this.reset();
      if (previous && version <= previous.version && !shouldReset) return;
      records[key] = { version, cleared: shouldReset };
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(records), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (error) {
      throw new AuthError('API_RESET_FAILED', '无法完成管理员停用后的 API 配置清理或记录，请检查本地文件权限后重试登录。', { cause: error });
    }
  }
}
