import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import type { ProviderSettings, ProviderSettingsInput } from '../../electron/services/providerTypes';
import { DEFAULT_VIDEO_PARSER_OPTIONS, type VideoParserOptions } from '../../electron/services/videoParserConfig';

function editableConfig(config: ProviderSettings): ProviderSettingsInput {
  return { llmBaseUrl: config.llmBaseUrl, llmModel: config.llmModel, videoParserEndpoint: config.videoParserEndpoint,
    videoParserProvider: config.videoParserProvider || 'custom', linkDigestMaxCredits: config.linkDigestMaxCredits ?? 5,
    videoParserOptions: { ...DEFAULT_VIDEO_PARSER_OPTIONS, ...config.videoParserOptions }, llmApiKey: '', videoParserApiKey: '' };
}

export function ProviderSettingsForm() {
  const user = useAuthStore(state => state.user);
  const canConfigure = !!user;
  const [config, setConfig] = useState<ProviderSettings | null>(null);
  const [input, setInput] = useState<ProviderSettingsInput>({ llmBaseUrl: '', llmModel: '', videoParserEndpoint: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setConfig(null); setInput({ llmBaseUrl: '', llmModel: '', videoParserEndpoint: '' }); setMessage('');
    if (canConfigure) {
      void window.electronAPI?.getProviderSettings().then(result => {
        if (!active) return;
        if (result.success && result.config) { setConfig(result.config); setInput(editableConfig(result.config)); }
        else setMessage(result.error || '读取本设备接口配置失败');
      }).catch(() => { if (active) setMessage('读取本设备接口配置失败'); });
    }
    return () => { active = false; };
  }, [user?.id, canConfigure]);
  if (!canConfigure) return <p className="text-sm text-slate-600">请先登录后配置本设备接口。</p>;
  const fields: { key: 'llmBaseUrl' | 'llmModel' | 'llmApiKey' | 'videoParserEndpoint' | 'videoParserApiKey'; label: string; placeholder: string; secret?: boolean }[] = [
    { key: 'llmBaseUrl', label: '模型 Base URL（HTTPS，兼容 OpenAI）', placeholder: '按厂商文档填写，例如 https://api.example.com/v1' },
    { key: 'llmModel', label: '模型名称', placeholder: '填写厂商提供的模型 ID' },
    { key: 'llmApiKey', label: '模型 API Key', placeholder: '留空保留已保存的密钥', secret: true },
    { key: 'videoParserEndpoint', label: '内容提取接口完整地址（HTTPS）', placeholder: '填写厂商的具体接口地址，例如 https://api.example.com/extract' },
    { key: 'videoParserApiKey', label: '内容提取 API Key', placeholder: '填写所选厂商的 API Key，留空保留已保存的密钥', secret: true },
  ];
  const options = input.videoParserOptions || DEFAULT_VIDEO_PARSER_OPTIONS;
  function updateOption<K extends keyof VideoParserOptions>(key: K, value: VideoParserOptions[K]) {
    setInput(state => ({ ...state, videoParserOptions: { ...DEFAULT_VIDEO_PARSER_OPTIONS, ...state.videoParserOptions, [key]: value } }));
  }
  const inputClass = 'mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 bg-slate-50';
  const renderField = (field: typeof fields[number]) => <label key={field.key} className="block text-xs font-semibold text-slate-700">
    {field.label}
    <input name={field.key} type={field.secret ? 'password' : 'text'} autoComplete="off" disabled={busy || !config}
      placeholder={field.placeholder} value={input[field.key] || ''}
      onChange={event => setInput(state => ({ ...state, [field.key]: event.target.value }))} className={inputClass} />
  </label>;
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await window.electronAPI?.saveProviderSettings(input);
      if (!result?.success || !result.config) throw new Error(result?.error || '保存失败');
      setConfig(result.config); setInput(editableConfig(result.config)); setMessage('本设备接口配置已加密保存');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  }}>
    <p className="text-xs text-slate-500">选择厂商后，在此填写模型或内容提取接口。配置与密钥加密保存在本机，重启和退出登录后仍保留；新设备为空。密钥框留空保留已有值，填写新密钥覆盖旧值。</p>
    <p className="text-xs text-slate-600">模型密钥：{config?.llmKeyConfigured ? '已配置' : '未配置'}；内容提取密钥：{config?.videoKeyConfigured ? '已配置' : '未配置'}</p>
    <fieldset disabled={busy || !config} className="space-y-4 rounded-xl border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-800">AI 二创</legend>
      <button type="button" className="rounded-lg border px-3 py-1.5 text-xs text-indigo-700" onClick={() => {
        setInput(state => ({ ...state, llmBaseUrl: 'https://api.deepseek.com', llmModel: 'deepseek-flash' }));
      }}>使用 DeepSeek 配置</button>
      {fields.slice(0, 3).map(renderField)}
    </fieldset>
    <fieldset disabled={busy || !config} className="space-y-4 rounded-xl border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-800">内容提取</legend>
      <label className="block text-xs font-semibold text-slate-700">提取厂商
        <select name="videoParserProvider" className={inputClass} value={input.videoParserProvider || 'custom'}
          onChange={event => setInput(state => ({ ...state, videoParserProvider: event.target.value as ProviderSettingsInput['videoParserProvider'] }))}>
          <option value="custom">自定义接口（高级配置）</option>
          <option value="linkdigest">LinkDigest（文案＋口播＋图文 OCR）</option>
          <option value="yaoan">姚安 AIGC（链接解析＋口播转写）</option>
        </select>
      </label>
      {input.videoParserProvider === 'yaoan' && <p className="text-xs text-slate-500">只需填写该平台的一把 Key，自动选择抖音或小红书视频转文字接口。使用平台自带转写，无需另配语音识别密钥。更换厂商时须填写对应 Key。</p>}
      {input.videoParserProvider === 'linkdigest' && <>
        <p className="text-xs text-slate-500">填写 LinkDigest Key 即可。自动等待异步结果，不重复提交；读取发布文案、口播和图文 OCR。抖音链接可能被平台拒绝，不保证完整读取。新提取可能计费，二创只调用模型。</p>
        <label className="block text-xs font-semibold text-slate-700">单次提取积分上限
          <input name="linkDigestMaxCredits" type="number" min={1} max={1000} step={1} className={inputClass}
            value={input.linkDigestMaxCredits ?? 5} onChange={event => setInput(state => ({ ...state, linkDigestMaxCredits: Number(event.target.value) }))} />
        </label>
        <p className="text-xs text-slate-500">默认 5 积分，超限请求由厂商拒绝；不主动请求预算内的部分读取。等待上限约 150 秒；取消或停权仅停止本机等待，不保证厂商停止任务或退款。</p>
      </>}
      {fields.slice(3).filter(field => (input.videoParserProvider || 'custom') === 'custom' || field.key !== 'videoParserEndpoint').map(renderField)}
    {(input.videoParserProvider || 'custom') === 'custom' && <details className="rounded-xl border border-slate-200 p-4 text-xs text-slate-700">
      <summary className="cursor-pointer font-semibold">内容提取高级配置（按厂商文档填写）</summary>
      <fieldset disabled={busy || !config} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label>请求方式
          <select name="videoParserOptions.method" className={inputClass} value={options.method}
            onChange={event => updateOption('method', event.target.value as VideoParserOptions['method'])}>
            <option value="POST">POST（JSON）</option><option value="GET">GET（查询参数）</option>
          </select>
        </label>
        <label>鉴权方式
          <select name="videoParserOptions.authMode" className={inputClass} value={options.authMode}
            onChange={event => updateOption('authMode', event.target.value as VideoParserOptions['authMode'])}>
            <option value="bearer">Authorization: Bearer</option><option value="header">自定义请求头</option>
            <option value="query">查询参数</option><option value="none">无需密钥</option>
          </select>
        </label>
        {(options.authMode === 'header' || options.authMode === 'query') && <label>密钥参数名
          <input name="videoParserOptions.apiKeyName" className={inputClass} value={options.apiKeyName} maxLength={64}
            placeholder={options.authMode === 'header' ? '例如 X-API-Key' : '例如 api_key 或 apiKey'}
            onChange={event => updateOption('apiKeyName', event.target.value)} />
        </label>}
        <label>分享链接参数名
          <input name="videoParserOptions.urlField" className={inputClass} value={options.urlField} maxLength={64}
            placeholder="例如 url、share_url、share_text" onChange={event => updateOption('urlField', event.target.value)} />
        </label>
        <label>返回文本字段路径
          <input name="videoParserOptions.textPath" className={inputClass} value={options.textPath} maxLength={256}
            placeholder="例如 data.audio_text" onChange={event => updateOption('textPath', event.target.value)} />
        </label>
        <label>返回标题字段路径（可选）
          <input name="videoParserOptions.titlePath" className={inputClass} value={options.titlePath} maxLength={256}
            placeholder="例如 data.title 或 data.desc" onChange={event => updateOption('titlePath', event.target.value)} />
        </label>
        <label>请求超时（秒）
          <input name="videoParserOptions.timeoutSeconds" type="number" min={1} max={300} step={1} className={inputClass}
            value={options.timeoutSeconds} onChange={event => updateOption('timeoutSeconds', Number(event.target.value))} />
        </label>
      </fieldset>
      <p className="mt-3 text-slate-500">字段路径从完整 JSON 响应开始填写，用点分隔，数组示例：data.items.0.text。文本路径留空时读取 data 或根对象中的 transcript / asr_text。接口须直接返回文本；仅返回视频或图片地址时，需由厂商提供转写或识别服务。</p>
    </details>}
    </fieldset>
    <p className="text-xs text-slate-500">接口由本机直接调用，服务器仅校验账号权限。使用真实接口前，请关闭上方的仿真模式。测试模型连接使用已保存的配置。</p>
    <div className="flex gap-3">
      <button disabled={busy || !config} className="px-4 py-2 text-xs rounded-xl bg-indigo-600 text-white disabled:opacity-50">保存本设备接口配置</button>
      <button type="button" disabled={busy || !config} className="px-4 py-2 text-xs rounded-xl border disabled:opacity-50" onClick={async () => {
        setBusy(true); setMessage('');
        try { const result = await window.electronAPI?.testLLMConnection({}); setMessage(result?.message || result?.error || '连接失败'); }
        catch { setMessage('连接失败'); } finally { setBusy(false); }
      }}>测试模型连接</button>
    </div>
    {message && <p role="status" className="text-xs text-slate-700">{message}</p>}
  </form>;
}
