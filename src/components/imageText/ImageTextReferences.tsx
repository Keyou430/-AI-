import type { ImageReference } from '../../../electron/services/imageTextTypes';
import { Button } from '../ui/Button';
import { ImageAssetPreview } from './ImageTextResult';

export function ImageTextReferences({ references, onRemove, disabled = false }: {
  references: ImageReference[]; onRemove: (id: string) => void; disabled?: boolean;
}) {
  if (!references.length) return null;
  return <div className="space-y-2 text-xs">
    <p className="muted-copy">参考素材 {references.length} / 30；移除即释放名额并解除当前绑定，历史文件保留，取消优化不撤销移除。</p>
    {references.map(reference => <div key={reference.id} className="flex items-start gap-2 rounded-md border p-2">
      <details className="disclosure min-w-0 flex-1"><summary className="break-all">{reference.kind === 'style' ? '原帖风格' : '场景素材'}：{reference.name}</summary><ImageAssetPreview id={reference.id} alt={reference.name} /></details>
      <Button size="sm" disabled={disabled} aria-label={'移除参考图 ' + reference.name} onClick={() => onRemove(reference.id)}>移除</Button>
    </div>)}
  </div>;
}
