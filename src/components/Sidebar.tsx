import { useEffect, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Tooltip } from '@base-ui/react/tooltip';
import { AnimatePresence, motion } from 'motion/react';
import {
  Film,
  History,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import type { ActiveNavTab } from '../types';
import { cn } from '../lib/utils';
import { Button } from './ui/Button';

export function Sidebar() {
  const activeNav = useAppStore((state) => state.activeNav);
  const setActiveNav = useAppStore((state) => state.setActiveNav);
  const historyCount = useAppStore((state) => state.historyRecords.length);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const { user, signOut } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [compactViewport, setCompactViewport] = useState(
    () => !window.matchMedia('(min-width: 1280px)').matches
  );
  const collapsed = sidebarCollapsed ?? compactViewport;
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1280px)');
    const mobile = window.matchMedia('(max-width: 767px)');
    const update = () => {
      setCompactViewport(!desktop.matches);
      if (!mobile.matches) setOpen(false);
    };
    update();
    desktop.addEventListener('change', update);
    mobile.addEventListener('change', update);
    return () => {
      desktop.removeEventListener('change', update);
      mobile.removeEventListener('change', update);
    };
  }, []);
  const items = [
    { id: 'workbench' as const, label: '二创工作台', icon: Sparkles },
    { id: 'history' as const, label: '历史记录', icon: History },
    { id: 'settings' as const, label: '设置', icon: Settings },
    ...(user?.role === 'admin'
      ? [{ id: 'accounts' as const, label: '账号管理', icon: Users }]
      : []),
  ];
  const navigate = (id: ActiveNavTab) => {
    setActiveNav(id);
    setOpen(false);
  };
  const content = (mobile: boolean) => {
    const compact = !mobile && collapsed;
    return (
      <>
        <div
          className={cn(
            'flex h-20 shrink-0 items-center gap-3',
            compact ? 'justify-center' : 'px-5'
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-card">
            <Film size={18} strokeWidth={1.7} />
          </span>
          {!compact && <p className="min-w-0 text-sm font-semibold tracking-tight">视频二创</p>}
        </div>
        <nav
          id={mobile ? 'mobile-navigation' : 'desktop-navigation'}
          aria-label="主导航"
          className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-y-contain px-3 pt-3"
        >
          {items.map(({ id, label, icon: Icon }) => (
            <Tooltip.Root key={id} disabled={!compact}>
              <Tooltip.Trigger
                render={
                  <button
                    type="button"
                    aria-current={activeNav === id ? 'page' : undefined}
                    aria-label={label}
                    onClick={() => navigate(id)}
                    className={cn(
                      'relative flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors',
                      activeNav === id
                        ? 'font-medium text-accent-foreground'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                      compact && 'justify-center'
                    )}
                  />
                }
              >
                <AnimatePresence>
                  {activeNav === id && (
                    <motion.span
                      layoutId={mobile ? 'mobile-nav' : 'desktop-nav'}
                      className="absolute inset-0 rounded-md bg-accent"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.14 }}
                    />
                  )}
                </AnimatePresence>
                <Icon className="relative h-[18px] w-[18px] shrink-0" strokeWidth={1.7} />
                {!compact && <span className="relative">{label}</span>}
                {!compact && id === 'history' && historyCount > 0 && (
                  <span className="relative ml-auto text-xs tabular-nums text-muted-foreground">
                    {historyCount}
                  </span>
                )}
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Positioner side="right" sideOffset={8} className="z-[60]">
                  <Tooltip.Popup className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm">
                    {label}
                  </Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
          ))}
        </nav>
        <div className="mx-3 mb-4 shrink-0 border-t pt-3">
          {!mobile && (
            <Button
              variant="ghost"
              className={cn('mb-3 w-full', compact ? 'px-0' : 'justify-start px-2')}
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
              aria-expanded={!collapsed}
              aria-controls="desktop-navigation"
              title={collapsed ? '展开侧栏' : '收起侧栏'}
              onClick={() => setSidebarCollapsed(!collapsed)}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              {!compact && '收起侧栏'}
            </Button>
          )}
          <div className={cn('flex items-center gap-2', compact ? 'justify-center' : 'px-1')}>
            {!compact && (
              <>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                  {user?.displayName.slice(0, 1) || '用'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{user?.displayName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {user?.role === 'admin' ? '管理员' : '成员'}
                  </p>
                </div>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="退出登录"
              title="退出登录"
              onClick={() => {
                setOpen(false);
                setActiveNav('workbench');
                void signOut();
              }}
            >
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </>
    );
  };
  return (
    <Tooltip.Provider delay={300}>
      <a
        href="#main-content"
        className="sr-only z-[100] rounded-md bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        跳到主要内容
      </a>
      <aside
        data-collapsed={collapsed}
        className={cn(
          'relative hidden h-full min-h-0 shrink-0 flex-col overflow-hidden border-r bg-sidebar transition-[width] duration-150 md:flex',
          collapsed ? 'w-[72px]' : 'w-[224px]'
        )}
      >
        {content(false)}
      </aside>
      <header className="flex h-14 shrink-0 items-center border-b bg-card px-3 md:hidden">
        <div className="flex items-center gap-2">
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger render={<Button variant="ghost" size="icon" aria-label="打开导航" />}>
              <Menu />
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="dialog-backdrop" />
              <Dialog.Popup className="drawer-popup">
                <Dialog.Title className="sr-only">导航</Dialog.Title>
                <Dialog.Description className="sr-only">
                  选择工作台、历史记录或设置
                </Dialog.Description>
                <Dialog.Close
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-2"
                      aria-label="关闭导航"
                    />
                  }
                >
                  <X />
                </Dialog.Close>
                {content(true)}
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
          <span className="text-sm font-semibold">视频二创</span>
        </div>
      </header>
    </Tooltip.Provider>
  );
}
