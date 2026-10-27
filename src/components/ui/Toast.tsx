import { Toast } from '@base-ui/react/toast';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import type { ReactNode } from 'react';

const manager = Toast.createToastManager<Record<string, never>>();

export function notifyError(message: string, title = '操作未完成') {
  manager.add({ id: title, title, description: message, type: 'error', priority: 'high', timeout: 8000 });
}

export function notifySuccess(message: string) {
  manager.add({ title: message, type: 'success', timeout: 4000 });
}

function ToastViewport() {
  const { toasts } = Toast.useToastManager<Record<string, never>>();
  return <Toast.Portal>
    <Toast.Viewport className="toast-viewport" aria-label="操作提示">
      {toasts.map((toast) => <Toast.Root key={toast.id} toast={toast} className="toast-item" swipeDirection="right">
        {toast.type === 'error' ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />}
        <Toast.Content className="min-w-0 flex-1">
          <Toast.Title className="text-sm font-semibold" />
          <Toast.Description className="mt-1 break-words text-sm leading-relaxed text-muted-foreground" />
        </Toast.Content>
        <Toast.Close aria-label="关闭提示" className="-my-3 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><X className="h-4 w-4" /></Toast.Close>
      </Toast.Root>)}
    </Toast.Viewport>
  </Toast.Portal>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return <Toast.Provider toastManager={manager} limit={3}>
    {children}
    <ToastViewport />
  </Toast.Provider>;
}
