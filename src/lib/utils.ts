import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const creationGrid = 'grid min-h-0 flex-1 grid-cols-1 gap-4 p-3 md:p-4 lg:grid-cols-[clamp(300px,30%,440px)_minmax(0,1fr)]';
export const historyGrid = 'grid min-h-0 flex-1 grid-cols-1 gap-4 p-3 md:p-4 lg:grid-cols-[clamp(260px,22%,320px)_minmax(0,1fr)]';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}
