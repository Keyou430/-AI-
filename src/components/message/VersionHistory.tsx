import type { RefinementVersion } from '../../types';
import { formatDateTime } from '../../lib/utils';
import { Button } from '../ui/Button';

interface VersionHistoryProps {
  versions: RefinementVersion[];
  currentScript?: string;
  onRestore: (version: RefinementVersion) => void;
  disabled?: boolean;
}
export function VersionHistory({
  versions,
  currentScript,
  onRestore,
  disabled,
}: VersionHistoryProps) {
  if (!versions.length) return null;
  return (
    <details className="disclosure">
      <summary>
        历史版本 <span className="ml-1 font-normal text-muted-foreground">{versions.length}</span>
      </summary>
      <ol className="mt-3 max-h-56 space-y-1 overflow-y-auto">
        {[...versions].reverse().map((version) => (
          <li
            key={version.id}
            className="flex items-start justify-between gap-3 border-t py-3 first:border-0"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">
                第 {version.round} 版{' '}
                <span className="ml-2 font-normal text-muted-foreground">
                  {formatDateTime(version.timestamp)}
                </span>
              </p>
              <p className="mt-1 break-words text-xs leading-relaxed">{version.instruction}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || version.scriptSnapshot === currentScript}
              onClick={() => onRestore(version)}
            >
              {version.scriptSnapshot === currentScript ? '当前版本' : '回退此版'}
            </Button>
          </li>
        ))}
      </ol>
    </details>
  );
}
