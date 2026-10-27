import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { notifyError, notifySuccess } from '../components/ui/Toast';
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
  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const newPassword = useRef<HTMLInputElement>(null);
  const inputClass = 'field';

  const load = async () => {
    const result = await window.electronAPI!.listUsers();
    if (!result.success) throw new Error(result.error || '读取账号失败');
    setUsers(result.users || []);
  };
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);

  const run = async (action: () => Promise<AuthResult>, message: string, refresh = true) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await action();
      if (!result.success) throw new Error(result.error || '操作失败');
      if (refresh) await load();
      setNotice(message);
      notifySuccess(message);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '操作失败，请稍后重试';
      setError(message);
      notifyError(message, '账号操作未完成');
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
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password'));
    const message = password.length < 8 || password.length > 128
      ? '新密码长度须为 8 至 128 位'
      : password !== data.get('confirmPassword') ? '两次输入的密码不一致，请重新确认' : '';
    if (message) { setError(message); notifyError(message, '密码未重置'); return; }
    if (await run(() => window.electronAPI!.resetUserPassword({ userId: targetId, password }), '密码已重置，原登录会话已失效', targetId !== currentUser?.id)) {
      setResetTarget(null);
      if (targetId === currentUser?.id) useAuthStore.getState().invalidate('密码已更新，请重新登录');
    }
  };

  return <div className="settings-page min-h-0 flex-1 overflow-auto space-y-6">
    <div><h1 className="text-xl font-semibold tracking-tight">账号管理</h1>
      <p className="mt-2 text-sm text-muted-foreground">{mode === 'remote' ? '统一管理员工账号。停用后撤销全部会话，员工端定时校验并锁定。' : '管理本机账号。停用账号后，其后续操作将被拦截。'}</p></div>
    {error && !resetTarget && !deleteTarget && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    <form onSubmit={create} className="surface p-5 space-y-4">
      <h2 className="font-semibold">新增账号</h2>
      <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 flex-1 gap-1 text-sm">账号<input name="username" required pattern="[a-zA-Z0-9_.-]{3,50}" maxLength={50} className={inputClass} /></label>
        <label className="grid min-w-0 flex-1 gap-1 text-sm">姓名<input name="displayName" required maxLength={100} className={inputClass} /></label>
        <label className="grid min-w-0 flex-1 gap-1 text-sm">初始密码<input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" className={inputClass} /></label>
        <label className="grid min-w-0 flex-1 gap-1 text-sm">角色<select name="role" className={inputClass}><option value="member">成员</option><option value="admin">管理员</option></select></label>
        <button className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">新增账号</button>
      </fieldset>
    </form>
    <div className="overflow-x-auto surface">
      <table className="w-full text-left text-sm"><thead className="bg-muted text-muted-foreground"><tr>
        {['账号', '姓名', '角色', '状态', '操作'].map((title) => <th key={title} className="p-4">{title}</th>)}
      </tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-t">
        <td className="p-4">{user.username}</td><td className="p-4">{user.displayName}</td>
        <td className="p-4">{user.role === 'admin' ? '管理员' : '成员'}</td><td className="p-4">{user.isActive ? '启用' : '停用'}</td>
        <td className="p-4"><div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button disabled={busy || user.username === 'admin' || user.id === currentUser?.id} className="text-accent-foreground disabled:text-slate-400"
            onClick={() => run(() => window.electronAPI!.setUserActive({ userId: user.id, active: !user.isActive }), '账号状态已更新')}>
            {user.isActive ? '停用' : '启用'}</button>
          <button disabled={busy} className="min-h-11 text-accent-foreground" onClick={() => { setError(null); setResetTarget(user); }}>重置密码</button>
          <button disabled={busy || user.username === 'admin' || user.id === currentUser?.id} className="min-h-11 text-destructive disabled:text-muted-foreground"
            title={user.username === 'admin' || user.id === currentUser?.id ? '不能删除内置管理员或当前登录账号' : '删除账号'}
            onClick={() => { setError(null); setDeleteTarget(user); }}>删除</button>
          </div>
        </td>
      </tr>)}</tbody></table>
    </div>
    <Modal open={!!resetTarget} onOpenChange={(open) => { if (!open) { setResetTarget(null); setError(null); } }}
      centered busy={busy} initialFocus={newPassword} title="重置密码"
      description={resetTarget ? `为 ${resetTarget.displayName}（${resetTarget.username}）设置新密码。` : ''}>
      {resetTarget && <form id="reset-password-form" onSubmit={reset} noValidate className="space-y-4">
        <p className="text-sm text-muted-foreground">重置后，该账号所有设备的登录会话将失效，需要使用新密码重新登录。</p>
        <fieldset disabled={busy} className="space-y-4">
          <label className="grid gap-2 text-sm">新密码<input ref={newPassword} key={resetTarget.id} name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" className={inputClass} aria-describedby="password-rule" /></label>
          <p id="password-rule" className="text-xs text-muted-foreground">请输入 8 至 128 位密码。</p>
          <label className="grid gap-2 text-sm">确认新密码<input name="confirmPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" className={inputClass} /></label>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="ghost" disabled={busy} onClick={() => { setResetTarget(null); setError(null); }}>取消</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? '正在重置…' : '确认重置'}</Button>
        </div>
      </form>}
    </Modal>
    <Modal open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setError(null); } }}
      centered busy={busy} initialFocus={cancelDelete} title="删除账号"
      description={deleteTarget ? `确认删除 ${deleteTarget.displayName}（${deleteTarget.username}）？` : ''}>
      <p className="text-sm leading-relaxed text-muted-foreground">删除后，该账号将无法登录，已有登录会话会被撤销。此操作不可撤销，已有业务历史记录不受影响。</p>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      <div className="mt-5 flex justify-end gap-2 border-t pt-4">
        <Button ref={cancelDelete} variant="ghost" disabled={busy} onClick={() => { setDeleteTarget(null); setError(null); }}>取消</Button>
        <Button variant="danger" disabled={busy} onClick={async () => {
          if (!deleteTarget) return;
          if (await run(() => window.electronAPI!.deleteUser({ userId: deleteTarget.id }), '账号已删除')) setDeleteTarget(null);
        }}>{busy ? '正在删除…' : '确认删除'}</Button>
      </div>
    </Modal>
  </div>;
};
