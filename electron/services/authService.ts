import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { AuthError } from './authError';
export { AuthError } from './authError';
import type { DBUser, LocalSQLiteManager } from '../db/sqliteService';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}


function publicUser(user: DBUser): AuthUser {
  return { id: user.id, username: user.username, displayName: user.display_name,
    role: user.role, isActive: user.is_active === 1, createdAt: user.created_at,
    lastLoginAt: user.last_login_at };
}

let activeHashes = 0;
async function hashPassword(password: string, salt: string): Promise<Buffer> {
  if (activeHashes >= 4) throw new AuthError('SERVICE_BUSY', '服务繁忙，请稍后再试');
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (error, value) => error ? reject(error) : resolve(value)));
  } finally { activeHashes--; }
}

async function passwordFields(password: string): Promise<Pick<DBUser, 'salt' | 'password_hash'>> {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new AuthError('INVALID_PASSWORD', '密码长度须为 8 至 128 位');
  }
  const salt = randomBytes(16).toString('hex');
  return { salt, password_hash: (await hashPassword(password, salt)).toString('hex') };
}

export class AuthService {
  private readonly sessions = new Map<number, string>();
  private readonly loginAttempts = new Map<number, object>();
  private readonly userRevisions = new Map<string, number>();
  constructor(private readonly db: LocalSQLiteManager) {}

  async status(senderId: number) {
    await this.db.ensureInitialized();
    const userId = this.sessions.get(senderId);
    const user = userId ? this.db.findUser('id', userId) : undefined;
    if (user && user.is_active !== 1) this.logout(senderId);
    return { needsSetup: this.db.listUsers().length === 0,
      user: user?.is_active === 1 ? publicUser(user) : null };
  }

  async setup(senderId: number, password: string, displayName: string): Promise<AuthUser> {
    await this.db.ensureInitialized();
    if (this.db.listUsers().length) throw new AuthError('ALREADY_INITIALIZED', '管理员已初始化，请登录');
    const user = await this.newUser({ username: 'admin', password, displayName, role: 'admin' }, async () => {
      if (this.db.listUsers().length) throw new AuthError('ALREADY_INITIALIZED', '管理员已初始化，请登录');
    });
    this.sessions.set(senderId, user.id);
    return publicUser(user);
  }

  async login(senderId: number, username: string, password: string): Promise<AuthUser> {
    await this.db.ensureInitialized();
    this.logout(senderId);
    const attempt = {};
    this.loginAttempts.set(senderId, attempt);
    try {
      if (typeof username !== 'string' || username.length > 128 || typeof password !== 'string' || password.length > 128) {
        throw new AuthError('INVALID_CREDENTIALS', '账号或密码错误');
      }
      const user = this.db.findUser('username', username.trim());
      const revision = user ? this.userRevisions.get(user.id) : undefined;
      const salt = user?.salt || randomBytes(16).toString('hex');
      const candidate = await hashPassword(password, salt);
      const stored = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64);
      if (!user || stored.length !== candidate.length || !timingSafeEqual(candidate, stored)) {
        throw new AuthError('INVALID_CREDENTIALS', '账号或密码错误');
      }
      const current = this.db.findUser('id', user.id);
      if (this.loginAttempts.get(senderId) !== attempt || !current || current.password_hash !== user.password_hash ||
          this.userRevisions.get(user.id) !== revision) throw new AuthError('AUTH_REQUIRED', '登录已失效，请重新登录');
      if (current.is_active !== 1) throw new AuthError('ACCOUNT_DISABLED', '当前账号已被管理员停用');
      current.last_login_at = new Date().toISOString();
      this.db.saveUser(current);
      this.sessions.set(senderId, current.id);
      return publicUser(current);
    } finally { if (this.loginAttempts.get(senderId) === attempt) this.loginAttempts.delete(senderId); }
  }

  logout(senderId: number): void { this.sessions.delete(senderId); this.loginAttempts.delete(senderId); }

  async requireUser(senderId: number, adminOnly = false): Promise<AuthUser> {
    await this.db.ensureInitialized();
    const userId = this.sessions.get(senderId);
    const user = userId ? this.db.findUser('id', userId) : undefined;
    if (!user || user.is_active !== 1) {
      this.logout(senderId);
      throw new AuthError(user ? 'ACCOUNT_DISABLED' : 'AUTH_REQUIRED',
        user ? '当前账号已被管理员停用，请重新登录' : '请先登录');
    }
    if (adminOnly && user.role !== 'admin') throw new AuthError('FORBIDDEN', '仅管理员可执行此操作');
    return publicUser(user);
  }

  async listUsers(senderId: number): Promise<AuthUser[]> {
    await this.requireUser(senderId, true);
    return this.db.listUsers().map(publicUser);
  }

  private async newUser(input: { username: string; password: string; displayName: string; role: 'admin' | 'member' }, validate: () => Promise<void>): Promise<DBUser> {
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username) || !displayName || displayName.length > 100) {
      throw new AuthError('INVALID_USER', '账号须为 3 至 50 位字母、数字、下划线、点或短横线，姓名须为 1 至 100 字');
    }
    if (input.role !== 'admin' && input.role !== 'member') throw new AuthError('INVALID_ROLE', '角色无效');
    if (this.db.findUser('username', username)) throw new AuthError('USERNAME_EXISTS', '账号已存在');
    const fields = await passwordFields(input.password);
    await validate();
    if (this.db.findUser('username', username)) throw new AuthError('USERNAME_EXISTS', '账号已存在');
    const user: DBUser = { id: randomUUID(), username, display_name: displayName,
      ...fields, role: input.role, is_active: 1,
      created_at: new Date().toISOString(), last_login_at: null };
    this.db.saveUser(user);
    return user;
  }

  async createUser(senderId: number, input: { username: string; password: string; displayName: string; role: 'admin' | 'member' }): Promise<AuthUser> {
    await this.requireUser(senderId, true);
    return publicUser(await this.newUser(input, async () => { await this.requireUser(senderId, true); }));
  }

  async setActive(senderId: number, userId: string, active: boolean): Promise<void> {
    const actor = await this.requireUser(senderId, true);
    const user = this.db.findUser('id', userId);
    if (!user) throw new AuthError('USER_NOT_FOUND', '账号不存在');
    if (typeof active !== 'boolean') throw new AuthError('INVALID_STATUS', '账号状态无效');
    if (!active && (user.username === 'admin' || user.id === actor.id)) {
      throw new AuthError('PROTECTED_ACCOUNT', '不能停用内置管理员或当前账号');
    }
    user.is_active = active ? 1 : 0;
    this.db.saveUser(user);
    if (!active) {
      this.userRevisions.set(userId, (this.userRevisions.get(userId) || 0) + 1);
      for (const [sessionId, id] of this.sessions) if (id === userId) this.logout(sessionId);
    }
  }

  async deleteUser(senderId: number, userId: string): Promise<void> {
    const actor = await this.requireUser(senderId, true);
    const user = this.db.findUser('id', userId);
    if (!user) throw new AuthError('USER_NOT_FOUND', '账号不存在，可能已被其他管理员删除');
    if (user.username === 'admin' || user.id === actor.id) {
      throw new AuthError('PROTECTED_ACCOUNT', '不能删除内置管理员或当前登录账号');
    }
    this.db.deleteUser(userId);
    this.userRevisions.set(userId, (this.userRevisions.get(userId) || 0) + 1);
    for (const [sessionId, id] of this.sessions) if (id === userId) this.logout(sessionId);
  }

  async resetPassword(senderId: number, userId: string, password: string): Promise<void> {
    await this.requireUser(senderId, true);
    const fields = await passwordFields(password);
    await this.requireUser(senderId, true);
    const user = this.db.findUser('id', userId);
    if (!user) throw new AuthError('USER_NOT_FOUND', '账号不存在');
    this.userRevisions.set(userId, (this.userRevisions.get(userId) || 0) + 1);
    Object.assign(user, fields);
    this.db.saveUser(user);
    for (const [sessionId, id] of this.sessions) if (id === userId) this.logout(sessionId);
  }
}
