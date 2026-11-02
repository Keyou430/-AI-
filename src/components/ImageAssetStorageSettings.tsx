import { useEffect, useState } from 'react';
import type { ImageAssetLocationInfo } from '../../electron/services/imageAssetLocation';
import { Button } from './ui/Button';
import { notifyError } from './ui/Toast';
export function ImageAssetStorageSettings() {
  const [location,setLocation] = useState<ImageAssetLocationInfo | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const report = (e: unknown) => { const message = e instanceof Error ? e.message : '图文素材存储设置失败。'; setError(message); notifyError(message); };
  useEffect(() => { let active = true;
    void window.electronAPI?.getImageAssetLocation().then(r => { if (!active) return; if (!r.success || !r.data) throw new Error(r.error || '读取素材地址失败。'); setLocation(r.data); }).catch(report);
    return () => { active = false; };
  }, []);
  const change = async (follow: boolean) => {
    setBusy(true);setError('');
    try { const r = follow ? await window.electronAPI?.followDataImageAssetLocation() : await window.electronAPI?.chooseImageAssetLocation();
      if (r?.canceled) return; if (!r?.success || !r.data) throw new Error(r?.error || '更改素材地址失败。'); setLocation(r.data);
    } catch(e) { report(e); } finally { setBusy(false); }
  };
  return <section className="surface space-y-4 p-5 sm:p-6" aria-labelledby="image-asset-storage-title">
    <h3 id="image-asset-storage-title" className="section-title">图文素材存储地址</h3>
    <p className="muted-copy">{location?.followsData ? '当前跟随数据存储地址。' : '当前使用独立素材目录。'}保留全部成功图片版本。更改后下次启动迁移，原目录保留备份，迁移期间占用空间可能暂时翻倍；核对后可手动清理备份。</p>
    <label className="block"><span className="field-label">当前素材地址</span><input className="field" readOnly aria-label="当前素材地址" value={location?.directory || ''} /></label>
    <p className="text-xs text-muted-foreground">{location?.count ?? 0} 个图片文件 · {((location?.bytes || 0)/1024/1024).toFixed(2)} MB</p>
    {location?.pendingDirectory && <p role="status" className="status-note break-all">下次启动使用：{location.pendingDirectory}</p>}
    {location?.migrationError && <p role="alert" className="text-sm text-destructive">迁移或访问提示：{location.migrationError}</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !location} onClick={() => { void change(false); }}>更改素材地址</Button><Button size="sm" disabled={busy || !location || (location.followsData && !location.pendingDirectory)} onClick={() => { void change(true); }}>恢复跟随数据存储地址</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
