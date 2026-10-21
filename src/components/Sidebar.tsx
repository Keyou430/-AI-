import React from 'react';
import {
  Sparkles,
  History,
  Settings,
  Film,
  CheckCircle2,
  Cpu,
} from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { ActiveNavTab } from '../types';
import { cn } from '../lib/utils';

export const Sidebar: React.FC = () => {
  const { activeNav, setActiveNav, historyRecords, settings, knowledgeDocs } =
    useAppStore();

  const navItems: Array<{
    id: ActiveNavTab;
    label: string;
    desc: string;
    icon: React.ReactNode;
    badge?: string | number;
  }> = [
    {
      id: 'workbench',
      label: '二创工作台',
      desc: '提取链接与生成脚本',
      icon: <Sparkles className="w-5 h-5" />,
    },
    {
      id: 'history',
      label: '历史记录',
      desc: '管理与导出二创记录',
      icon: <History className="w-5 h-5" />,
      badge: historyRecords.length,
    },
    {
      id: 'settings',
      label: '系统设置',
      desc: '知识库、关键词与API',
      icon: <Settings className="w-5 h-5" />,
    },
  ];

  const { user, signOut } = useAuthStore();
  if (user?.role === 'admin') navItems.push({ id: 'accounts', label: '账号管理', desc: '成员权限与账号状态', icon: <Settings className="w-5 h-5" /> });

  const activeKbCount = knowledgeDocs.filter((d) => d.enabled).length;

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0 select-none">
      <div>
        {/* 顶部品牌标识 */}
        <div className="p-5 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm shadow-indigo-200">
            <Film className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">
              视频二创AI助手
            </h1>
            <p className="text-xs text-slate-500">桌面创作工作台</p>
          </div>
        </div>

        <div className="px-5 py-3 flex justify-between items-center text-sm text-slate-600">
          <span>{user?.displayName}</span>
          <button onClick={() => { setActiveNav('workbench'); void signOut(); }} className="text-indigo-600">退出登录</button>
        </div>
        {/* 导航列表 */}
        <nav className="p-3 space-y-1.5">
          {navItems.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                className={cn(
                  'w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition-all',
                  isActive
                    ? 'bg-indigo-50/90 text-indigo-700 font-semibold shadow-sm ring-1 ring-indigo-200/60'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'p-1.5 rounded-lg',
                      isActive
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-500'
                    )}
                  >
                    {item.icon}
                  </span>
                  <div>
                    <div className="text-sm leading-none">{item.label}</div>
                    <div className="text-[11px] text-slate-400 mt-1 font-normal">
                      {item.desc}
                    </div>
                  </div>
                </div>
                {item.badge !== undefined && (
                  <span
                    className={cn(
                      'text-xs px-2 py-0.5 rounded-full font-medium',
                      isActive
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-slate-100 text-slate-600'
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* 底部运行状态卡片 */}
      <div className="p-3.5 m-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-indigo-600" />
            当前模型
          </span>
          <span className="font-medium text-slate-800 truncate max-w-[110px]">
            {settings.llmModel || 'deepseek-chat'}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">已挂载知识库</span>
          <span className="font-medium text-indigo-600">{activeKbCount} 份文档</span>
        </div>

        <div className="pt-1.5 border-t border-slate-200/70 flex items-center gap-1.5 text-[11px] text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
          <span>
            {settings.llmApiKey.trim() && !settings.enableMockFallback
              ? '直连大模型 API 模式'
              : 'MVP 仿真流式引擎已就绪'}
          </span>
        </div>
      </div>
    </aside>
  );
};
