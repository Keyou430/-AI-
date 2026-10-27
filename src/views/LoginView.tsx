import React, { useState } from 'react';
import { Film } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../store/useAuthStore';

export const LoginView: React.FC = () => {
  const { needsSetup, error, signIn } = useAuthStore();
  const [busy, setBusy] = useState(false);
  const inputClass = 'field';

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const success = await signIn(
      String(data.get('username') || 'admin'),
      String(data.get('password') || ''),
      String(data.get('displayName') || '管理员')
    );
    if (success) form.reset();
    setBusy(false);
  };

  return (
    <main className="h-dvh min-h-0 overflow-y-auto overscroll-y-contain bg-background p-5">
      <div className="flex min-h-full items-center justify-center">
        <form
          onSubmit={submit}
          className="surface mx-auto my-auto w-full max-w-sm p-7 sm:p-8 space-y-5"
        >
          <Film className="h-9 w-9 text-foreground" />
          <h1 className="text-xl font-semibold tracking-tight">
            {needsSetup ? '初始化管理员' : '登录视频二创助手'}
          </h1>
          {needsSetup ? (
            <>
              <p className="text-sm text-muted-foreground">
                首次使用，请为管理员账号 admin 设置姓名和密码。
              </p>
              <label className="block text-sm space-y-2">
                <span>管理员姓名</span>
                <input
                  name="displayName"
                  required
                  maxLength={100}
                  autoComplete="name"
                  className={inputClass}
                />
              </label>
            </>
          ) : (
            <label className="block text-sm space-y-2">
              <span>账号</span>
              <input name="username" required autoComplete="username" className={inputClass} />
            </label>
          )}
          <label className="block text-sm space-y-2">
            <span>密码</span>
            <input
              name="password"
              type="password"
              required
              minLength={needsSetup ? 8 : 1}
              maxLength={128}
              autoComplete={needsSetup ? 'new-password' : 'current-password'}
              className={inputClass}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !window.electronAPI}
            className="w-full"
          >
            {busy ? '处理中…' : needsSetup ? '创建管理员并进入' : '登录'}
          </Button>
        </form>
      </div>
    </main>
  );
};
