import React, { useEffect, useState } from 'react';
import type { AuthResult, AuthUser } from '../types';
import { useAuthStore } from '../store/useAuthStore';

export const AccountsView: React.FC = () => {
  const currentUser = useAuthStore((state) => state.user);
  const mode = useAuthStore((state) => state.mode);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<AuthUser | null>(null);
  const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm';

  const load = async () => {
    const result = await window.electronAPI!.listUsers();
    if (!result.success) throw new Error(result.error || '读取账号失败');
    setUsers(result.users || []);
  };
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);

  const run = async (action: () => Promise<AuthResult>, message: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await action();
      if (!result.success) throw new Error(result.error || '操作失败');
      await load();
      setNotice(message);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      return false;
    } finally { setBusy(false); }
  };

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const success = await run(() => window.electronAPI!.createUser({
      username: String(data.get('username')), displayName: String(data.get('displayName')),
      password: String(data.get('password')), role: data.get('role') === 'admin' ? 'admin' : 'member',
    }), '账号已创建');
    if (success) form.reset();
  };

  const reset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetTarget) return;
    const targetId = resetTarget.id;
    const password = String(new FormData(event.currentTarget).get('password'));
    if (await run(() => window.electronAPI!.resetUserPassword({ userId: targetId, password }), '密码已重置，原登录会话已失效')) {
      setResetTarget(null);
      if (targetId === currentUser?.id) useAuthStore.getState().invalidate('密码已更新，请重新登录');
    }
  };

  return <div className="flex-1 overflow-auto p-8 space-y-6">
    <div><h1 className="text-2xl font-bold text-slate-900">账号管理</h1>
      <p className="mt-2 text-sm text-slate-500">{mode === 'remote' ? '统一管理员工账号。停用后撤销全部会话，员工端定时校验并锁定。' : '管理本机账号。停用账号后，其后续操作将被拦截。'}</p></div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    <form onSubmit={create} className="rounded-xl border bg-white p-5 space-y-4">
      <h2 className="font-semibold">新增账号</h2>
      <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">账号<input name="username" required pattern="[a-zA-Z0-9_.-]{3,50}" maxLength={50} className={inputClass} /></label>
        <label className="grid gap-1 text-sm">姓名<input name="displayName" required maxLength={100} className={inputClass} /></label>
        <label className="grid gap-1 text-sm">初始密码<input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" className={inputClass} /></label>
        <label className="grid gap-1 text-sm">角色<select name="role" className={inputClass}><option value="member">成员</option><option value="admin">管理员</option></select></label>
        <button className="rounded-lg bg-indigo-600 px-4 py-2 text-white">新增账号</button>
      </fieldset>
    </form>
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>
        {['账号', '姓名', '角色', '状态', '操作'].map((title) => <th key={title} className="p-4">{title}</th>)}
      </tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-t">
        <td className="p-4">{user.username}</td><td className="p-4">{user.displayName}</td>
        <td className="p-4">{user.role === 'admin' ? '管理员' : '成员'}</td><td className="p-4">{user.isActive ? '启用' : '停用'}</td>
        <td className="p-4 space-x-4">
          <button disabled={busy || user.username === 'admin' || user.id === currentUser?.id} className="text-indigo-600 disabled:text-slate-400"
            onClick={() => run(() => window.electronAPI!.setUserActive({ userId: user.id, active: !user.isActive }), '账号状态已更新')}>
            {user.isActive ? '停用' : '启用'}</button>
          <button disabled={busy} className="text-indigo-600" onClick={() => setResetTarget(user)}>重置密码</button>
        </td>
      </tr>)}</tbody></table>
    </div>
    {resetTarget && <form onSubmit={reset} className="rounded-xl border bg-white p-5 space-y-4">
      <h2 className="font-semibold">重置 {resetTarget.displayName} 的密码</h2>
      <fieldset disabled={busy} className="flex items-end gap-3">
        <label className="grid gap-1 text-sm">新密码<input key={resetTarget.id} name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" className={inputClass} /></label>
        <button className="rounded-lg bg-indigo-600 px-4 py-2 text-white">确认重置</button>
        <button type="button" onClick={() => setResetTarget(null)} className="px-4 py-2 text-slate-600">取消</button>
      </fieldset>
    </form>}
  </div>;
};
