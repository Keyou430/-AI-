import { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import type { RefinementVersion } from '../types';
import { Composer } from './composer/Composer';
import { VersionHistory } from './message/VersionHistory';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

interface OptimizeDialogProps {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSubmitInstruction: (instruction: string) => void;
  onRollbackVersion: (version: RefinementVersion) => void;
  refinementHistory: RefinementVersion[];
  isGenerating: boolean;
  currentScript: string;
}
const QUICK_PROMPTS = ['开头更有吸引力', '口播更简洁自然', '突出产品卖点'];
export function OptimizeDialog({
  open,
  onOpenChange,
  onSubmitInstruction,
  onRollbackVersion,
  refinementHistory,
  isGenerating,
  currentScript,
}: OptimizeDialogProps) {
  const [instruction, setInstruction] = useState('');
  const submit = () => {
    if (!instruction.trim() || isGenerating) return;
    onSubmitInstruction(instruction.trim());
    setInstruction('');
    onOpenChange(false);
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      initialFocus={(interaction) =>
        interaction === 'touch'
          ? true
          : document.querySelector<HTMLTextAreaElement>('#optimize-form textarea')
      }
      title="优化脚本"
      description="描述你想调整的地方，当前脚本与上下文会自动保留。"
      footer={
        <>
          <span className="mr-auto hidden text-xs text-muted-foreground sm:block">
            Ctrl + 回车发送
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="submit"
            form="optimize-form"
            variant="primary"
            disabled={!instruction.trim() || isGenerating}
          >
            <ArrowUp />
            发送并优化
          </Button>
        </>
      }
    >
      <form
        id="optimize-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Composer
          label="修改意见"
          value={instruction}
          onValueChange={setInstruction}
          onSubmit={submit}
          busy={isGenerating}
          minHeight={150}
          maxHeight={280}
          placeholder="例如：缩短第二个镜头，让结尾更自然。"
        />
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((prompt) => (
            <Button
              key={prompt}
              size="sm"
              variant="ghost"
              disabled={isGenerating}
              onClick={() => setInstruction((value) => (value ? value + '；' + prompt : prompt))}
            >
              {prompt}
            </Button>
          ))}
        </div>
      </form>
      <div className="mt-5">
        <VersionHistory
          versions={refinementHistory}
          currentScript={currentScript}
          disabled={isGenerating}
          onRestore={(version) => {
            onRollbackVersion(version);
            onOpenChange(false);
          }}
        />
      </div>
    </Modal>
  );
}
