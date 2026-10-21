import React, { useEffect } from 'react';
import { LoginView } from './views/LoginView';
import { AccountsView } from './views/AccountsView';
import { useAuthStore } from './store/useAuthStore';
import { Sidebar } from './components/Sidebar';
import { WorkbenchView } from './views/WorkbenchView';
import { HistoryView } from './views/HistoryView';
import { SettingsView } from './views/SettingsView';
import { useAppStore } from './store/useAppStore';

export const App: React.FC = () => {
  const { user, initialized, initialize, invalidate } = useAuthStore();
  useEffect(() => {
    initialize();
    return window.electronAPI?.onAuthRequired(({ message }) => invalidate(message));
  }, [initialize, invalidate]);
  if (!initialized) return <main className="p-8 text-slate-500">正在读取登录状态…</main>;
  if (!user) return <LoginView />;
  return <AuthenticatedApp />;
};

const AuthenticatedApp: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const {
    activeNav,
    setActiveNav,
    loadHistoryFromSQLite,
    loadKnowledgeDocsFromSQLite,
  } = useAppStore();

  useEffect(() => {
    setActiveNav('workbench');
    loadHistoryFromSQLite();
    loadKnowledgeDocsFromSQLite();
  }, [setActiveNav, loadHistoryFromSQLite, loadKnowledgeDocsFromSQLite]);

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-slate-50 text-slate-900">
      <Sidebar />
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {activeNav === 'workbench' && <WorkbenchView />}
        {activeNav === 'history' && <HistoryView />}
        {activeNav === 'settings' && <SettingsView />}
        {activeNav === 'accounts' && user?.role === 'admin' && <AccountsView />}
      </main>
    </div>
  );
};

export default App;
