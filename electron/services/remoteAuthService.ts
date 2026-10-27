import { AuthError } from './authError';
import type { AuthService, AuthUser } from './authService';

export function validateAuthUrl(value: string, allowLoopback = false): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AuthError('AUTH_CONFIG_INVALID', '授权服务地址未正确配置'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowLoopback && loopback && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new AuthError('AUTH_CONFIG_INVALID', '授权服务必须使用 HTTPS 根地址');
  }
  return url.origin;
}

const authMessages: Record<string, string> = {
  INVALID_CONFIG: '服务配置无效，请检查 HTTPS 地址及模型名称', PROVIDER_NOT_CONFIGURED: '请联系管理员配置公司接口密钥',
  SERVICE_BUSY: '服务繁忙，请稍后再试', INTERNAL_ERROR: '服务器调用失败，请联系管理员检查配置',
  INVALID_CREDENTIALS: '账号或密码错误', ACCOUNT_DISABLED: '当前账号已被管理员停用',
  AUTH_REQUIRED: '登录已失效，请重新登录', FORBIDDEN: '仅管理员可执行此操作',
  INVALID_PASSWORD: '密码长度须为 8 至 128 位', USERNAME_EXISTS: '账号已存在',
  INVALID_USER: '账号或姓名格式无效', INVALID_ROLE: '角色无效',
  INVALID_STATUS: '账号状态无效', USER_NOT_FOUND: '账号不存在',
  PROTECTED_ACCOUNT: '不能停用或删除内置管理员及当前登录账号', RATE_LIMITED: '登录尝试过于频繁，请稍后再试',
};

// 员工版只使用服务端账号；凭据和令牌均不写入本地数据库。
export class RemoteAuthService implements Pick<AuthService,
  'status' | 'setup' | 'login' | 'requireUser' | 'listUsers' | 'createUser' | 'setActive' | 'resetPassword' | 'deleteUser'> {
  private readonly sessions = new Map<number, { token: string; generation: number; controller: AbortController }>();
  private readonly generations = new Map<number, number>();
  private readonly baseUrl: string;
  constructor(url: string, private readonly timeoutMs = 5000, allowLoopback = false) {
    this.baseUrl = validateAuthUrl(url, allowLoopback);
  }

  private async request(route: string, input?: unknown, token?: string): Promise<any> {
    try {
      const response = await fetch(this.baseUrl + '/v1/' + route, {
        method: input === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: input === undefined ? undefined : JSON.stringify(input), signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (route === 'users/delete' && response.status === 404) {
        throw new AuthError('SERVICE_UPDATE_REQUIRED', '授权服务尚未支持删除账号，请联系管理员更新服务后重试');
      }
      const data = await response.json();
      if (!response.ok || !data.success) {
        const code = typeof data.errorCode === 'string' && authMessages[data.errorCode] ? data.errorCode : 'AUTH_UNAVAILABLE';
        throw new AuthError(code, authMessages[code] || '无法验证授权，请检查网络后重新登录');
      }
      return data;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('AUTH_UNAVAILABLE', '无法连接授权服务，请检查网络后重新登录');
    }
  }

  hasSession(senderId: number): boolean { return this.sessions.has(senderId); }

  watchSession(senderId: number, onInvalidated: (error: unknown) => void, intervalMs = 30000) {
    let checking = false;
    let stopped = false;
    const check = async () => {
      if (stopped || checking || !this.hasSession(senderId)) return;
      checking = true;
      try { await this.requireUser(senderId); }
      catch (error) { if (!stopped && !this.hasSession(senderId)) onInvalidated(error); }
      finally { checking = false; }
    };
    const timer = setInterval(() => { void check(); }, intervalMs);
    timer.unref();
    return { check, stop: () => { stopped = true; clearInterval(timer); } };
  }

  async status(senderId: number) {
    return { needsSetup: false, user: this.sessions.has(senderId) ? await this.requireUser(senderId) : null };
  }
  async setup(_senderId: number, _password: string, _displayName: string): Promise<AuthUser> {
    throw new AuthError('FORBIDDEN', '员工版账号由管理员统一创建');
  }
  async login(senderId: number, username: string, password: string): Promise<AuthUser> {
    const logout = this.logout(senderId);
    const generation = this.generations.get(senderId) || 0;
    await logout;
    if (this.generations.get(senderId) !== generation) throw new AuthError('AUTH_REQUIRED', '登录已取消，请重新登录');
    const result = await this.request('login', { username, password });
    if (this.generations.get(senderId) !== generation) {
      void this.request('logout', {}, result.token).catch(() => {});
      throw new AuthError('AUTH_REQUIRED', '登录已取消，请重新登录');
    }
    if (typeof result.token !== 'string' || !/^[a-f0-9]{64}$/.test(result.token) || !result.user?.id ||
        result.user.isActive !== true || !['admin', 'member'].includes(result.user.role)) {
      throw new AuthError('AUTH_UNAVAILABLE', '授权服务返回无效登录信息');
    }
    this.sessions.set(senderId, { token: result.token, generation, controller: new AbortController() });
    return result.user;
  }
  async logout(senderId: number): Promise<void> {
    const session = this.sessions.get(senderId);
    session?.controller.abort();
    this.sessions.delete(senderId);
    this.generations.set(senderId, (this.generations.get(senderId) || 0) + 1);
    if (session) await this.request('logout', {}, session.token).catch(() => {});
  }
  private async authorized(senderId: number, route: string, input?: unknown): Promise<any> {
    const session = this.sessions.get(senderId);
    if (!session) throw new AuthError('AUTH_REQUIRED', '请先登录');
    try {
      const result = await this.request(route, input, session.token);
      if (this.sessions.get(senderId) !== session) throw new AuthError('AUTH_REQUIRED', '登录已失效，请重新登录');
      return result;
    } catch (error) {
      if (error instanceof AuthError && ['AUTH_REQUIRED', 'ACCOUNT_DISABLED', 'AUTH_UNAVAILABLE'].includes(error.code) &&
          this.sessions.get(senderId) === session) {
        // 网络失败也撤销本地会话，禁止离线继续使用。
        void this.logout(senderId);
      }
      throw error;
    }
  }
  async requireUser(senderId: number, adminOnly = false): Promise<AuthUser> {
    const { user } = await this.authorized(senderId, 'me');
    if (!user?.id || user.isActive !== true || !['admin', 'member'].includes(user.role)) {
      void this.logout(senderId);
      throw new AuthError('AUTH_REQUIRED', '登录已失效，请重新登录');
    }
    if (adminOnly && user.role !== 'admin') throw new AuthError('FORBIDDEN', '仅管理员可执行此操作');
    return user;
  }
  async listUsers(senderId: number): Promise<AuthUser[]> { return (await this.authorized(senderId, 'users')).users; }
  async createUser(senderId: number, input: { username: string; password: string; displayName: string; role: 'admin' | 'member' }): Promise<AuthUser> {
    return (await this.authorized(senderId, 'users/create', input)).user;
  }
  async setActive(senderId: number, userId: string, active: boolean): Promise<void> {
    await this.authorized(senderId, 'users/status', { userId, active });
  }
  async runAuthorizedTask<T>(senderId: number, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal,
    intervalMs = 1000): Promise<T> {
    const session = this.sessions.get(senderId);
    if (!session) throw new AuthError('AUTH_REQUIRED', '请先登录');
    const combined = AbortSignal.any([session.controller.signal, AbortSignal.timeout(180000), ...(signal ? [signal] : [])]);
    const watch = this.watchSession(senderId, () => {}, intervalMs);
    try {
      await this.requireUser(senderId);
      combined.throwIfAborted();
      const result = await task(combined);
      combined.throwIfAborted();
      await this.requireUser(senderId);
      combined.throwIfAborted();
      return result;
    } catch (error) {
      if (session.controller.signal.aborted || this.sessions.get(senderId) !== session) {
        throw new AuthError('AUTH_REQUIRED', '登录已失效，任务已取消');
      }
      throw error;
    } finally { watch.stop(); }
  }
  async deleteUser(senderId: number, userId: string): Promise<void> {
    await this.authorized(senderId, 'users/delete', { userId });
  }
  async resetPassword(senderId: number, userId: string, password: string): Promise<void> {
    await this.authorized(senderId, 'users/password', { userId, password });
  }
}
