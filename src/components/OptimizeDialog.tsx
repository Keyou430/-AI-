import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Wand2,
  X,
  Sparkles,
  History,
  RotateCcw,
  MessageSquarePlus,
} from 'lucide-react';
import { RefinementVersion } from '../types';
import { formatDateTime } from '../lib/utils';

interface OptimizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitInstruction: (instruction: string) => void;
  onRollbackVersion: (version: RefinementVersion) => void;
  refinementHistory: RefinementVersion[];
  isGenerating: boolean;
}

const QUICK_PROMPTS = [
  '进一步强化本公司核心产品卖点与原热点痛点的结合度',
  '黄金前3秒提问更犀利，增强打工人情绪共鸣',
  '语气更幽默接地气，口播节奏更明快',
  '在第3个收尾镜头自然加入限时买赠转化引导',
  '突出产品高颜值琥珀分层特写与极简桌面氛围感',
];

export const OptimizeDialog: React.FC<OptimizeDialogProps> = ({
  open,
  onOpenChange,
  onSubmitInstruction,
  onRollbackVersion,
  refinementHistory,
  isGenerating,
}) => {
  const [instruction, setInstruction] = useState('');

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!instruction.trim() || isGenerating) return;
    onSubmitInstruction(instruction.trim());
    setInstruction('');
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 p-6 z-50 focus:outline-none max-h-[88vh] flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Wand2 className="w-5 h-5" />
              </div>
              <div>
                <Dialog.Title className="text-base font-bold text-slate-900">
                  多轮对话式迭代优化 (Phase 3 上下文记忆引擎)
                </Dialog.Title>
                <Dialog.Description className="text-xs text-slate-500">
                  基于当前已生成的分镜脚本与历史对话上下文，继续追加修改指令或回退历史版本
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-5">
            {/* 历史多轮迭代轨迹与一键回滚 */}
            {refinementHistory.length > 0 && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span className="flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-indigo-600" />
                    当前会话多轮演进版本（共 {refinementHistory.length} 轮）
                  </span>
                  <span className="text-[11px] font-normal text-slate-500">
                    点击「回退此版」可随时恢复对应轮次的脚本快照
                  </span>
                </div>

                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {refinementHistory.map((ver) => (
                    <div
                      key={ver.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200/80 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold shrink-0">
                          第 {ver.round} 轮
                        </span>
                        <span className="text-slate-700 truncate font-medium">
                          {ver.instruction}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {formatDateTime(ver.timestamp)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onRollbackVersion(ver);
                          onOpenChange(false);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        回退此版
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <form id="optimize-form" onSubmit={handleConfirm} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  快捷多轮修改指令（点击快速叠加填入）
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map((preset) => (
                    <button
                      type="button"
                      key={preset}
                      onClick={() =>
                        setInstruction((prev) =>
                          prev ? `${prev}；${preset}` : preset
                        )
                      }
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 transition-colors"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5">
                  <MessageSquarePlus className="w-3.5 h-3.5 text-indigo-600" />
                  输入本轮追加修改意见（将自动携带前序脚本与知识库上下文）
                </label>
                <textarea
                  rows={4}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="例如：把第一个镜头的痛点提问改得更有悬念，同时在第三个镜头重点突出我们零脂冷萃冻干咖啡3秒冷水即溶的卖点..."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                />
              </div>
            </form>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 shrink-0">
            <Dialog.Close asChild>
              <button
                type="button"
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                取消
              </button>
            </Dialog.Close>
            <button
              type="submit"
              form="optimize-form"
              disabled={!instruction.trim() || isGenerating}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
            >
              <Sparkles className="w-4 h-4" />
              发送指令并迭代生成 (第 {refinementHistory.length + 1} 轮)
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
