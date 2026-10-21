import React, { useState } from 'react';
import {
  KeyRound,
  BookOpen,
  Tags,
  Upload,
  Trash2,
  Plus,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Briefcase,
  FolderSearch,
  Eye,
  X,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  selectNativeKnowledgeFilesClient,
  testLLMConnectionClient,
  uploadAndParseKnowledgeFileClient,
} from '../services/ipcClient';
import { KeywordTag, KnowledgeDocument } from '../types';
import { cn } from '../lib/utils';

export const SettingsView: React.FC = () => {
  const {
    settings,
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
  const [keywordCategory, setKeywordCategory] =
    useState<KeywordTag['category']>('brand');
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [parsingFiles, setParsingFiles] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<KnowledgeDocument | null>(null);

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    const res = await testLLMConnectionClient(settings);
    setTestingConnection(false);
    setConnectionResult(res);
  };

  // Phase 3: 使用 Electron 原生文件选择器直接调用主进程 pdf-parse / mammoth 解析本地文件
  const handleNativeDialogSelect = async () => {
    if (window.electronAPI?.selectAndParseKnowledgeFiles) {
      setParsingFiles(true);
      try {
        await selectNativeKnowledgeFilesClient();
        await loadKnowledgeDocsFromSQLite();
      } finally {
        setParsingFiles(false);
      }
    }
  };

  // 支持拖拽或普通 input[type=file] 上传并通过主进程解析 Buffer
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setParsingFiles(true);
    try {
      for (const file of Array.from(files)) {
        await uploadAndParseKnowledgeFileClient(file);
      }
      await loadKnowledgeDocsFromSQLite();
    } finally {
      setParsingFiles(false);
      e.target.value = '';
    }
  };

  const handleAddKeyword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    addKeyword(newKeyword, keywordCategory);
    setNewKeyword('');
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 1. 本公司主营业务与关键词配置 (PRD V1.1 核心升级) */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Briefcase className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                本公司主营业务与关键词配置（热点视频跨界融合锚点）
              </h2>
              <p className="text-xs text-slate-500">
                当输入当下热点视频时，AI 将提取原片爆款钩子并自动嫁接至下方配置的本公司主营业务与产品词上
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              本公司主营业务与核心场景概述
            </label>
            <textarea
              rows={2}
              value={settings.companyBusinessProfile}
              onChange={(e) =>
                updateSettings({ companyBusinessProfile: e.target.value })
              }
              placeholder="例如：主营精品零脂冷萃冻干咖啡与办公室便携冲调饮品，主打3秒冷水即溶、零蔗糖轻负担与早八高效提神场景..."
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-500 leading-relaxed"
            />
          </div>

          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-2">
              <Tags className="w-4 h-4 text-indigo-600" />
              <span className="text-xs font-bold text-slate-800">
                分类业务关键词管理
              </span>
            </div>

            <form onSubmit={handleAddKeyword} className="flex items-center gap-2.5">
              <select
                value={keywordCategory}
                onChange={(e) => setKeywordCategory(e.target.value as any)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs bg-slate-50"
              >
                <option value="brand">核心业务/产品词（必提）</option>
                <option value="jargon">客群痛点与转化卖点词</option>
                <option value="forbidden">严禁违禁词</option>
              </select>

              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="输入业务关键词回车添加..."
                className="flex-1 rounded-xl border border-slate-200 px-3.5 py-2 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-500"
              />

              <button
                type="submit"
                className="inline-flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <Plus className="w-3.5 h-3.5" />
                添加标签
              </button>
            </form>

            <div className="flex flex-wrap gap-2 pt-1">
              {keywords.map((kw) => (
                <span
                  key={kw.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border',
                    kw.category === 'brand' &&
                      'bg-indigo-50 text-indigo-700 border-indigo-200',
                    kw.category === 'jargon' &&
                      'bg-emerald-50 text-emerald-700 border-emerald-200',
                    kw.category === 'forbidden' &&
                      'bg-rose-50 text-rose-700 border-rose-200'
                  )}
                >
                  <span>
                    [
                    {kw.category === 'brand'
                      ? '业务/产品词'
                      : kw.category === 'jargon'
                      ? '转化卖点'
                      : '违禁词'}
                    ] {kw.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeKeyword(kw.id)}
                    className="hover:opacity-75"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* 2. Phase 3 本地企业知识库配置（支持 .pdf, .docx, .txt, .md 全文解析与 Prompt 注入） */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <BookOpen className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  本地企业知识库文件读取与 Prompt 注入 (Phase 3)
                </h2>
                <p className="text-xs text-slate-500">
                  通过 Node.js 本地解析 .pdf (pdf-parse)、.docx (mammoth)、.txt、.md 全文并存入 SQLite，生成脚本时自动拼接注入
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {typeof window !== 'undefined' &&
                Boolean(window.electronAPI?.selectAndParseKnowledgeFiles) && (
                  <button
                    type="button"
                    onClick={handleNativeDialogSelect}
                    disabled={parsingFiles}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    <FolderSearch className="w-3.5 h-3.5" />
                    选择本地文件解析
                  </button>
                )}

              <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                {parsingFiles ? '正在解析文档...' : '上传本地文档 (.pdf/.docx/.txt)'}
                <input
                  type="file"
                  multiple
                  accept=".txt,.md,.pdf,.docx,.csv,.json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div className="space-y-2.5">
            {knowledgeDocs.map((doc) => (
              <div
                key={doc.id}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 flex items-start justify-between gap-4"
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={doc.enabled}
                      onChange={() => toggleKnowledgeDoc(doc.id)}
                      className="rounded border-slate-300 text-indigo-600"
                    />
                    <span className="text-xs font-bold text-slate-800 truncate">
                      {doc.name}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium">
                      已提取 {doc.charCount || doc.fullContent?.length || 0} 字
                    </span>
                    <span className="text-[11px] text-slate-400">
                      ({(doc.sizeBytes / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 pl-5 line-clamp-2">
                    {doc.contentSnippet}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPreviewDoc(doc)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-indigo-600 hover:bg-indigo-50 font-medium"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    查看解析全文
                  </button>
                  <button
                    type="button"
                    onClick={() => removeKnowledgeDoc(doc.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 3. API 密钥管理（支持中国大陆主流大模型一键预设切换） */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  API 密钥与模型配置
                </h2>
                <p className="text-xs text-slate-500">
                  采用 OpenAI 标准接口协议，内置 DeepSeek、通义千问、字节豆包、Kimi 等国内直连预设
                </p>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.enableMockFallback}
                onChange={(e) =>
                  updateSettings({ enableMockFallback: e.target.checked })
                }
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              启用仿真模式（使用示例数据，不调用真实接口）
            </label>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                模型服务商预设
              </label>
              <select
                value={settings.llmProvider}
                onChange={(e) => {
                  const provider = e.target.value as any;
                  const presets: Record<
                    string,
                    { baseUrl: string; model: string }
                  > = {
                    deepseek: {
                      baseUrl: 'https://api.deepseek.com/v1',
                      model: 'deepseek-chat',
                    },
                    qwen: {
                      baseUrl:
                        'https://dashscope.aliyuncs.com/compatible-mode/v1',
                      model: 'qwen-plus',
                    },
                    doubao: {
                      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
                      model: 'doubao-pro-32k',
                    },
                    kimi: {
                      baseUrl: 'https://api.moonshot.cn/v1',
                      model: 'moonshot-v1-32k',
                    },
                    openai: {
                      baseUrl: 'https://api.openai.com/v1',
                      model: 'gpt-4o',
                    },
                  };
                  if (presets[provider]) {
                    updateSettings({
                      llmProvider: provider,
                      llmBaseUrl: presets[provider].baseUrl,
                      llmModel: presets[provider].model,
                    });
                  } else {
                    updateSettings({ llmProvider: 'custom' });
                  }
                }}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-500"
              >
                <option value="deepseek">DeepSeek (国内直连推荐)</option>
                <option value="qwen">阿里云百炼 (通义千问 qwen-plus)</option>
                <option value="doubao">火山方舟 (字节豆包)</option>
                <option value="kimi">月之暗面 (Kimi moonshot-v1-32k)</option>
                <option value="openai">OpenAI (GPT-4o)</option>
                <option value="custom">自定义 OpenAI 兼容接口</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Base URL
              </label>
              <input
                type="text"
                value={settings.llmBaseUrl}
                onChange={(e) => updateSettings({ llmBaseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                模型名称 (Model)
              </label>
              <input
                type="text"
                value={settings.llmModel}
                onChange={(e) => updateSettings({ llmModel: e.target.value })}
                placeholder="deepseek-chat"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                大模型 API Key
              </label>
              <input
                type="password"
                value={settings.llmApiKey}
                onChange={(e) => updateSettings({ llmApiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {testingConnection ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  测试中...
                </>
              ) : (
                '测试连接'
              )}
            </button>
          </div>

          {connectionResult && (
            <div
              className={cn(
                'p-3 rounded-xl border text-xs flex items-center gap-2',
                connectionResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              )}
            >
              {connectionResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>{connectionResult.message}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                第三方短视频解析 API 接口地址
              </label>
              <input
                type="text"
                value={settings.videoParserEndpoint}
                onChange={(e) =>
                  updateSettings({ videoParserEndpoint: e.target.value })
                }
                placeholder="填写已购买服务的解析接口地址"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                第三方视频提取 API Key
              </label>
              <input
                type="password"
                value={settings.videoParserApiKey}
                onChange={(e) =>
                  updateSettings({ videoParserApiKey: e.target.value })
                }
                placeholder="填写十目API或聚合数据密钥..."
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </section>
      </div>

      {/* 知识库文档全文预览弹窗 */}
      {previewDoc && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  本地知识库解析全文预览：{previewDoc.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  文件路径：{previewDoc.filePath} · 共提取{' '}
                  {previewDoc.charCount || previewDoc.fullContent.length} 字符
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 flex-1 overflow-y-auto">
              <pre className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 whitespace-pre-wrap leading-relaxed font-sans">
                {previewDoc.fullContent}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
