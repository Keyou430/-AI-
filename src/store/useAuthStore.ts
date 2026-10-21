import { create } from 'zustand';
import type { AuthUser } from '../types';
import '../services/ipcClient';

interface AuthState {
  user: AuthUser | null;
  initialized: boolean;
  needsSetup: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  signIn: (username: string, password: string, displayName?: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  invalidate: (message: string) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  initialized: false,
  needsSetup: false,
  error: null,
  initialize: async () => {
    if (!window.electronAPI) {
      set({ initialized: true, error: '请使用桌面客户端登录。' });
      return;
    }
    try {
      const result = await window.electronAPI.getAuthStatus();
      set({ user: result.user, needsSetup: result.needsSetup, initialized: true });
    } catch {
      set({ initialized: true, error: '读取登录状态失败，请重新打开应用。' });
    }
  },
  signIn: async (username, password, displayName) => {
    if (!window.electronAPI) return false;
    try {
      const result = get().needsSetup
        ? await window.electronAPI.setupAdmin({ password, displayName: displayName || '管理员' })
        : await window.electronAPI.login({ username, password });
      if (!result.success || !result.user) throw new Error(result.error || '登录失败');
      set({ user: result.user, needsSetup: false, error: null });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '登录失败' });
      return false;
    }
  },
  signOut: async () => {
    try { await window.electronAPI?.logout(); }
    finally { set({ user: null, error: null }); }
  },
  invalidate: (message) => set({ user: null, error: message }),
}));
