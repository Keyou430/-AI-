import { useId, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
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
  headerAction?: ReactNode;
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
  headerAction,
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
      <div className="mb-1.5 flex min-h-8 items-center justify-between gap-2">
        <label htmlFor={fieldId} className="text-xs font-medium text-muted-foreground">
          {label}
        </label>
        {headerAction && <div className="flex shrink-0 items-center gap-1">{headerAction}</div>}
      </div>
      <div
        className="composer"
        data-busy={busy}
        data-dragging={dragging && !busy && !props.disabled && !props.readOnly}
        aria-busy={busy}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy && !props.disabled && !props.readOnly) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (busy || props.disabled || props.readOnly) return;
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
        {dragging && !busy && !props.disabled && !props.readOnly && <div role="status" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-accent/90 p-4 text-sm font-medium text-accent-foreground">松开鼠标，将文字添加到文案</div>}
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
              !props.readOnly &&
              value.trim()
            ) {
              event.preventDefault();
              onSubmit();
            }
          }}
          className="block w-full resize-none bg-transparent px-3.5 py-3 text-sm leading-[1.85] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
          style={{ minHeight, maxHeight }}
        />
        <div className="flex min-h-9 items-center justify-between gap-3 border-t border-input bg-secondary/60 px-3.5 py-1.5 text-[11px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            {busy && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />}
            <span role={busy ? 'status' : undefined} className="truncate">{busy ? '正在生成，请稍候…' : hint || '支持粘贴或拖入文字'}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2.5 tabular-nums">
            {onSubmit && !busy && !props.disabled && !props.readOnly && value.trim() && <kbd className="hidden rounded border border-input bg-card px-1.5 py-0.5 font-mono text-[10px] leading-none sm:inline">Ctrl / ⌘ + Enter</kbd>}
            <span>{value.length.toLocaleString()} 字</span>
          </span>
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
