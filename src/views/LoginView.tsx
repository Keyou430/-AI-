import React, { useState } from 'react';
import { Film } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

export const LoginView: React.FC = () => {
  const { needsSetup, error, signIn } = useAuthStore();
  const [busy, setBusy] = useState(false);
  const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500';

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const success = await signIn(String(data.get('username') || 'admin'),
      String(data.get('password') || ''), String(data.get('displayName') || '管理员'));
    if (success) form.reset();
    setBusy(false);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-5">
        <Film className="w-10 h-10 text-indigo-600" />
        <h1 className="text-xl font-bold text-slate-900">{needsSetup ? '初始化管理员' : '登录视频二创 AI 助手'}</h1>
        {needsSetup ? <>
          <p className="text-sm text-slate-500">首次使用，请为管理员账号 admin 设置姓名和密码。</p>
          <label className="block text-sm space-y-2"><span>管理员姓名</span>
            <input name="displayName" required maxLength={100} autoComplete="name" className={inputClass} />
          </label>
        </> : <label className="block text-sm space-y-2"><span>账号</span>
          <input name="username" required autoComplete="username" className={inputClass} />
        </label>}
        <label className="block text-sm space-y-2"><span>密码</span>
          <input name="password" type="password" required minLength={needsSetup ? 8 : 1} maxLength={128}
            autoComplete={needsSetup ? 'new-password' : 'current-password'} className={inputClass} />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button disabled={busy || !window.electronAPI} className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-white disabled:opacity-50">
          {busy ? '处理中…' : needsSetup ? '创建管理员并进入' : '登录'}
        </button>
      </form>
    </main>
  );
};
