import { useId, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface ComposerProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange' | 'onSubmit'
> {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit?: () => void;
  busy?: boolean;
  hint?: string;
  minHeight?: number;
  maxHeight?: number;
}
export function Composer({
  label,
  value,
  onValueChange,
  onSubmit,
  busy = false,
  hint,
  minHeight = 160,
  maxHeight = 420,
  className,
  id,
  ...props
}: ComposerProps) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState('');
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = Math.min(maxHeight, Math.max(minHeight, element.scrollHeight)) + 'px';
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, minHeight, maxHeight]);
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={fieldId} className="field-label">
        {label}
      </label>
      <div
        className="composer"
        data-busy={busy}
        data-dragging={dragging}
        aria-busy={busy}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy && !props.disabled) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (busy || props.disabled) return;
          if (event.dataTransfer.files.length) {
            setDropError('文件请在系统设置的知识库中导入。');
            return;
          }
          const text =
            event.dataTransfer.getData('text/plain') || event.dataTransfer.getData('text/uri-list');
          if (text) {
            onValueChange(value ? value + '\n' + text : text);
            setDropError('');
            textarea.current?.focus();
          }
        }}
      >
        <textarea
          {...props}
          id={fieldId}
          ref={textarea}
          value={value}
          readOnly={busy || props.readOnly}
          onChange={(event) => {
            setDropError('');
            onValueChange(event.target.value);
          }}
          onKeyDown={(event) => {
            props.onKeyDown?.(event);
            if (
              !event.defaultPrevented &&
              !event.nativeEvent.isComposing &&
              (event.ctrlKey || event.metaKey) &&
              event.key === 'Enter' &&
              onSubmit &&
              !busy &&
              !props.disabled &&
              value.trim()
            ) {
              event.preventDefault();
              onSubmit();
            }
          }}
          className="block w-full resize-none bg-transparent px-3.5 py-3 text-sm leading-[1.85] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
          style={{ minHeight, maxHeight }}
        />
        <div className="flex min-h-8 items-center justify-between gap-3 px-3.5 pb-2 text-[11px] text-muted-foreground">
          <span>{busy ? '正在生成，请稍候' : hint || '支持粘贴或拖入文字'}</span>
          <span className="shrink-0 tabular-nums">{value.length.toLocaleString()} 字</span>
        </div>
      </div>
      {dropError && (
        <p role="alert" className="mt-2 text-xs text-warning">
          {dropError}
        </p>
      )}
    </div>
  );
}
