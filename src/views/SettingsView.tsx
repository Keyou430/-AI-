import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Eye, FolderOpen, LoaderCircle, Plus, Trash2, Upload, X } from 'lucide-react';
import { StorageSettings } from '../components/StorageSettings';
import { ProviderSettingsForm } from '../components/ProviderSettingsForm';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { notifyError } from '../components/ui/Toast';
import { useAppStore } from '../store/useAppStore';
import {
  selectNativeKnowledgeFilesClient,
  uploadAndParseKnowledgeFileClient,
} from '../services/ipcClient';
import type { KeywordTag, KnowledgeDocument } from '../types';
import { cn } from '../lib/utils';

export function SettingsView() {
  const {
    settings,
    settingsTab,
    setSettingsTab,
    updateSettings,
    knowledgeDocs,
    loadKnowledgeDocsFromSQLite,
    removeKnowledgeDoc,
    toggleKnowledgeDoc,
    keywords,
    addKeyword,
    removeKeyword,
  } = useAppStore();
  const [newKeyword, setNewKeyword] = useState('');
  const [category, setCategory] = useState<KeywordTag['category']>('brand');
  const [parsingFiles, setParsingFiles] = useState(false);
  const [fileError, updateFileError] = useState('');
  const setFileError = (message: string) => { updateFileError(message); if (message) notifyError(message, '知识库导入未完成'); };
  const [dragging, setDragging] = useState(false);
  const [logError, updateLogError] = useState('');
  const setLogError = (message: string) => { updateLogError(message); if (message) notifyError(message, '日志目录未打开'); };
  const [previewDoc, setPreviewDoc] = useState<KnowledgeDocument | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [settingsTab]);
  const importFiles = async (files?: File[]) => {
    if (parsingFiles) return;
    setParsingFiles(true);
    setFileError('');
    try {
      if (files) {
        for (const file of files) await uploadAndParseKnowledgeFileClient(file);
      } else if (window.electronAPI?.selectAndParseKnowledgeFiles)
        await selectNativeKnowledgeFilesClient();
      await loadKnowledgeDocsFromSQLite();
    } catch (error) {
      setFileError(error instanceof Error ? error.message : '文档导入失败，请检查格式后重试。');
    } finally {
      setParsingFiles(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (newKeyword.trim()) {
      addKeyword(newKeyword.trim(), category);
      setNewKeyword('');
    }
  };
  return (
    <Tabs.Root
      value={settingsTab}
      onValueChange={(value) => {
        if (value === 'content' || value === 'system') setSettingsTab(value);
      }}
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <header className="shrink-0 border-b px-4 pt-4 md:px-6 md:pt-6 lg:px-8 lg:pt-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-xl font-semibold tracking-tight">设置</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理内容背景、接口密钥和本设备存储。</p>
          <Tabs.List aria-label="设置分类" className="tab-list mt-5 pb-3">
            <Tabs.Tab value="content" className="tab min-h-11">
              内容设置
            </Tabs.Tab>
            <Tabs.Tab value="system" className="tab min-h-11">
              系统设置
            </Tabs.Tab>
          </Tabs.List>
        </div>
      </header>
      <div ref={scroll} className="settings-page min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl">
          <Tabs.Panel value="content" keepMounted className="space-y-5">
            <section className="surface space-y-5 p-5 sm:p-6" aria-labelledby="business-title">
              <div>
                <h2 id="business-title" className="section-title">
                  业务与关键词
                </h2>
                <p className="muted-copy mt-1">生成时会结合这里填写的业务背景。</p>
              </div>
              <div>
                <label htmlFor="business-profile" className="field-label">
                  主营业务
                </label>
                <textarea
                  id="business-profile"
                  rows={3}
                  value={settings.companyBusinessProfile}
                  onChange={(event) => updateSettings({ companyBusinessProfile: event.target.value })}
                  placeholder="介绍你的产品、服务与目标受众。"
                  className="field resize-y"
                />
              </div>
              <form onSubmit={add} className="flex flex-wrap gap-2">
                <label className="sr-only" htmlFor="keyword-category">
                  关键词分类
                </label>
                <select
                  id="keyword-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as KeywordTag['category'])}
                  className="field w-auto"
                >
                  <option value="brand">业务 / 产品</option>
                  <option value="jargon">卖点</option>
                  <option value="forbidden">禁用词</option>
                </select>
                <label htmlFor="new-keyword" className="sr-only">
                  业务关键词
                </label>
                <input
                  id="new-keyword"
                  value={newKeyword}
                  onChange={(event) => setNewKeyword(event.target.value)}
                  placeholder="输入关键词"
                  className="field min-w-[120px] flex-1"
                />
                <Button type="submit" size="sm" disabled={!newKeyword.trim()} aria-label="添加关键词">
                  <Plus />
                  <span className="hidden sm:inline">添加</span>
                </Button>
              </form>
              {keywords.length ? (
                <div className="flex flex-wrap gap-2">
                  {keywords.map((keyword) => (
                    <span
                      key={keyword.id}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md bg-muted pl-2.5 text-xs',
                        keyword.category === 'forbidden' && 'text-destructive'
                      )}
                    >
                      <span className="text-muted-foreground">
                        {keyword.category === 'brand'
                          ? '产品'
                          : keyword.category === 'jargon'
                            ? '卖点'
                            : '禁用'}
                      </span>
                      {keyword.text}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 px-2"
                        onClick={() => removeKeyword(keyword.id)}
                        aria-label={'移除关键词 ' + keyword.text}
                      >
                        <X />
                      </Button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">尚未添加关键词。</p>
              )}
            </section>
            <section className="surface space-y-4 p-5 sm:p-6" aria-labelledby="knowledge-title">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 id="knowledge-title" className="section-title">
                    公司知识库
                  </h2>
                  <p className="muted-copy mt-1">启用的文档会作为脚本生成的参考。</p>
                </div>
                <Button
                  size="sm"
                  disabled={parsingFiles}
                  onClick={() => {
                    if (window.electronAPI?.selectAndParseKnowledgeFiles) void importFiles();
                    else fileInput.current?.click();
                  }}
                >
                  {parsingFiles ? <LoaderCircle className="animate-spin" /> : <Upload />}
                  {parsingFiles ? '正在导入' : '导入文档'}
                </Button>
              </div>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept=".txt,.md,.pdf,.docx,.csv,.json"
                className="hidden"
                aria-label="选择知识库文档"
                onChange={(event) => {
                  if (event.target.files?.length) void importFiles(Array.from(event.target.files));
                }}
              />
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!parsingFiles) setDragging(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  if (event.dataTransfer.files.length)
                    void importFiles(Array.from(event.dataTransfer.files));
                }}
                className={cn(
                  'rounded-md border border-dashed px-4 py-5 text-center text-xs text-muted-foreground',
                  dragging && 'border-primary bg-accent'
                )}
              >
                <p>{dragging ? '松开以导入文档' : '将文档拖入这里'}</p>
                <p className="mt-1 text-[11px]">PDF、Word、TXT、Markdown、CSV、JSON</p>
              </div>
              {fileError && (
                <p role="alert" className="text-xs text-destructive">
                  {fileError}
                </p>
              )}
              <div className="divide-y">
                {knowledgeDocs.map((doc) => (
                  <div key={doc.id} className="flex items-start gap-3 py-4">
                    <input
                      type="checkbox"
                      checked={doc.enabled}
                      onChange={() => {
                        void toggleKnowledgeDoc(doc.id);
                      }}
                      aria-label={'启用文档 ' + doc.name}
                      className="mt-1 h-4 w-4 accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={doc.name}>
                        {doc.name}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {doc.contentSnippet}
                      </p>
                      <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                        {(doc.charCount || doc.fullContent.length).toLocaleString()} 字 ·{' '}
                        {(doc.sizeBytes / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <div className="flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={'预览 ' + doc.name}
                        onClick={() => setPreviewDoc(doc)}
                      >
                        <Eye />
                      </Button>
                      <Button
                        variant="danger"
                        size="icon"
                        aria-label={'删除 ' + doc.name}
                        onClick={() => {
                          void removeKnowledgeDoc(doc.id);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </Tabs.Panel>
          <Tabs.Panel value="system" keepMounted className="space-y-5">
            <section className="surface space-y-5 p-5 sm:p-6" aria-labelledby="provider-title">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="provider-title" className="section-title">
                  接口密钥与内容提取
                </h2>
              </div>
              <ProviderSettingsForm />
            </section>
            <details className="disclosure bg-card">
              <summary>诊断与日志</summary>
              <div className="mt-3 space-y-3 pb-2">
                <p className="muted-copy">遇到运行问题时，可查看本设备日志。</p>
                <Button
                  size="sm"
                  disabled={!window.electronAPI}
                  onClick={async () => {
                    setLogError('');
                    try {
                      const result = await window.electronAPI?.openLogFolder();
                      if (!result?.success) throw new Error(result?.error || '打开日志失败');
                    } catch (error) {
                      setLogError(error instanceof Error ? error.message : '打开日志失败');
                    }
                  }}
                >
                  <FolderOpen />
                  打开运行日志
                </Button>
                {logError && (
                  <p role="alert" className="text-xs text-destructive">
                    {logError}
                  </p>
                )}
              </div>
            </details>
            <StorageSettings />
          </Tabs.Panel>
        </div>
      </div>
      <Modal
        open={!!previewDoc}
        onOpenChange={(open) => {
          if (!open) setPreviewDoc(null);
        }}
        title={previewDoc?.name || '文档预览'}
        description="文档正文，仅在本设备保存。"
      >
        <pre className="reading-text font-sans">{previewDoc?.fullContent}</pre>
      </Modal>
    </Tabs.Root>
  );
}
