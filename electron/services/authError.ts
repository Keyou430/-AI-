export class AuthError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) { super(message, options); }
}

export interface ApiResetUser {
  id: string;
  role: 'admin' | 'member';
  apiResetVersion?: number;
}

export interface AuthLifecycle {
  signedIn(user: ApiResetUser, authority: string): void;
  disabled(user: ApiResetUser, authority: string): void;
}

export class AccountDisabledError extends AuthError {
  constructor(public readonly user: ApiResetUser) {
    super('ACCOUNT_DISABLED', '当前账号已被管理员停用');
  }
}
