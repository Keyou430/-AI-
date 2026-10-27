import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  initialFocus?: Dialog.Popup.Props['initialFocus'];
  centered?: boolean;
  busy?: boolean;
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  initialFocus,
  centered = false,
  busy = false,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Viewport className="dialog-viewport" data-centered={centered || undefined}>
          <Dialog.Popup className="dialog-popup" initialFocus={initialFocus}>
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <Dialog.Title className="section-title">{title}</Dialog.Title>
                <Dialog.Description className="muted-copy mt-1">{description}</Dialog.Description>
              </div>
              <Dialog.Close
                disabled={busy}
                render={
                  <Button variant="ghost" size="icon" aria-label="关闭" className="-mr-2 -mt-2" />
                }
              >
                <X />
              </Dialog.Close>
            </div>
            <div className="min-h-0 overflow-y-auto p-5">{children}</div>
            {footer && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-4">
                {footer}
              </div>
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
