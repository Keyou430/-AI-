import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { StorageLocation } from '../../electron/services/storageLocation';
import { Button } from './ui/Button';
import { notifyError } from './ui/Toast';

export function StorageSettings() {
  const [location, setLocation] = useState<StorageLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, updateError] = useState('');
  const setError = (message: string) => { updateError(message); if (message) notifyError(message, '存储设置未完成'); };
  useEffect(() => {
    let active = true;
    void window.electronAPI
      ?.getStorageLocation()
      .then((result) => {
        if (!active) return;
        if (result.success && result.location) setLocation(result.location);
        else setError(result.error || '读取存储地址失败');
      })
      .catch(() => {
        if (active) setError('读取存储地址失败');
      });
    return () => {
      active = false;
    };
  }, []);
  const chooseDirectory = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI?.chooseStorageLocation();
      if (!result?.success) throw new Error(result?.error || '更改存储地址失败');
      if (result.location) setLocation(result.location);
    } catch (error) {
      setError(error instanceof Error ? error.message : '更改存储地址失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="surface space-y-4 p-5 sm:p-6" aria-labelledby="storage-title">
      <h3 id="storage-title" className="section-title">
        存储地址
      </h3>
      <p className="muted-copy">
        历史记录与公司知识库保存在此目录。更改后，下次启动迁移并生效，原目录保留备份。
      </p>
      <label className="block">
        <span className="field-label">当前存储地址</span>
        <input
          aria-label="当前存储地址"
          className="field"
          readOnly
          value={location?.directory || ''}
          placeholder={window.electronAPI ? '正在读取…' : '请在桌面客户端配置'}
        />
      </label>
      {location?.migrationError && (
        <p role="alert" className="text-sm text-destructive">
          迁移未完成，仍使用原目录：{location.migrationError}
        </p>
      )}
      {location?.pendingDirectory && (
        <p role="status" className="status-note break-all">
          下次启动使用：{location.pendingDirectory}
        </p>
      )}
      <Button
        size="sm"
        disabled={busy || !location}
        onClick={() => {
          void chooseDirectory();
        }}
      >
        <FolderOpen />
        {busy ? '正在选择…' : '更改存储地址'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
