import { useEffect, useState } from 'react';
import { notifyError, notifySuccess } from './ui/Toast';
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
  const showError = (message: string) => { setMessage(message); notifyError(message, '接口配置未完成'); };
  useEffect(() => {
    let active = true;
    setConfig(null); setInput({ llmBaseUrl: '', llmModel: '', videoParserEndpoint: '' }); setMessage('');
    if (canConfigure) {
      void window.electronAPI?.getProviderSettings().then(result => {
        if (!active) return;
        if (result.success && result.config) { setConfig(result.config); setInput(editableConfig(result.config)); }
        else showError(result.error || '读取本设备接口配置失败，请重新打开设置后重试');
      }).catch(() => { if (active) showError('读取本设备接口配置失败，请重新打开设置后重试'); });
    }
    return () => { active = false; };
  }, [user?.id, canConfigure]);
  if (!canConfigure) return <p className="text-sm text-muted-foreground">请先登录后配置本设备接口。</p>;
  const fields: { key: 'llmBaseUrl' | 'llmModel' | 'llmApiKey' | 'videoParserEndpoint' | 'videoParserApiKey'; label: string; placeholder: string; secret?: boolean }[] = [
    { key: 'llmBaseUrl', label: '模型接口地址（兼容 OpenAI）', placeholder: '按厂商文档填写，例如 https://api.example.com/v1' },
    { key: 'llmModel', label: '模型名称', placeholder: '填写厂商提供的模型标识' },
    { key: 'llmApiKey', label: '模型接口密钥', placeholder: '留空保留已保存的密钥', secret: true },
    { key: 'videoParserEndpoint', label: '内容提取接口完整地址（HTTPS）', placeholder: '填写厂商的具体接口地址，例如 https://api.example.com/extract' },
    { key: 'videoParserApiKey', label: '内容提取接口密钥', placeholder: '填写所选厂商的接口密钥，留空保留已保存的密钥', secret: true },
  ];
  const options = input.videoParserOptions || DEFAULT_VIDEO_PARSER_OPTIONS;
  function updateOption<K extends keyof VideoParserOptions>(key: K, value: VideoParserOptions[K]) {
    setInput(state => ({ ...state, videoParserOptions: { ...DEFAULT_VIDEO_PARSER_OPTIONS, ...state.videoParserOptions, [key]: value } }));
  }
  const inputClass = 'field mt-1.5';
  const renderField = (field: typeof fields[number]) => <label key={field.key} className="block text-xs font-semibold text-foreground">
    {field.label}
    <input name={field.key} type={field.secret ? 'password' : 'text'} autoComplete="off" disabled={busy || !config}
      placeholder={field.placeholder} value={input[field.key] || ''}
      onChange={event => setInput(state => ({ ...state, [field.key]: event.target.value }))} className={inputClass} />
  </label>;
  return <form className="space-y-4" noValidate onSubmit={async event => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await window.electronAPI?.saveProviderSettings(input);
      if (!result?.success || !result.config) throw new Error(result?.error || '保存失败');
      setConfig(result.config); setInput(editableConfig(result.config)); setMessage('本设备接口配置已加密保存'); notifySuccess('本设备接口配置已加密保存');
    } catch (error) { showError(error instanceof Error ? error.message : '保存接口配置失败，请稍后重试'); }
    finally { setBusy(false); }
  }}>
    <p className="text-xs text-muted-foreground">配置仅保存在本设备。密钥留空保留已有值，输入新值即可替换。</p>
    <p className="text-xs text-muted-foreground">模型密钥：{config?.llmKeyConfigured ? '已配置' : '未配置'}；内容提取密钥：{config?.videoKeyConfigured ? '已配置' : '未配置'}</p>
    <fieldset disabled={busy || !config} className="space-y-4 border-t pt-5">
      <legend className="px-1 text-sm font-semibold text-foreground">智能二创</legend>
      <button type="button" className="rounded-lg border px-3 py-1.5 text-xs text-accent-foreground" onClick={() => {
        setInput(state => ({ ...state, llmBaseUrl: 'https://api.deepseek.com', llmModel: 'deepseek-flash' }));
      }}>使用 DeepSeek 配置</button>
      {fields.slice(0, 3).map(renderField)}
    </fieldset>
    <fieldset disabled={busy || !config} className="space-y-4 border-t pt-5">
      <legend className="px-1 text-sm font-semibold text-foreground">内容提取</legend>
      <label className="block text-xs font-semibold text-foreground">提取厂商
        <select name="videoParserProvider" className={inputClass} value={input.videoParserProvider || 'custom'}
          onChange={event => setInput(state => ({ ...state, videoParserProvider: event.target.value as ProviderSettingsInput['videoParserProvider'] }))}>
          <option value="custom">自定义接口（高级配置）</option>
          <option value="linkdigest">LinkDigest（文案＋口播＋图片文字识别）</option>
          <option value="yaoan">姚安（链接解析＋口播转写）</option>
        </select>
      </label>
      {input.videoParserProvider === 'yaoan' && <p className="text-xs text-muted-foreground">只需填写该平台的一个密钥，自动选择抖音或小红书视频转文字接口。使用平台自带转写，无需另配语音识别密钥。更换厂商时须填写对应密钥。</p>}
      {input.videoParserProvider === 'linkdigest' && <>
        <p className="text-xs text-muted-foreground">填写 LinkDigest 密钥即可。自动等待异步结果，不重复提交；读取发布文案、口播和图片文字识别。抖音链接可能被平台拒绝，不保证完整读取。新提取可能计费，二创只调用模型。</p>
        <label className="block text-xs font-semibold text-foreground">单次提取积分上限
          <input name="linkDigestMaxCredits" type="number" min={1} max={1000} step={1} className={inputClass}
            value={input.linkDigestMaxCredits ?? 5} onChange={event => setInput(state => ({ ...state, linkDigestMaxCredits: Number(event.target.value) }))} />
        </label>
        <p className="text-xs text-muted-foreground">默认 5 积分，超限请求由厂商拒绝；不主动请求预算内的部分读取。等待上限约 150 秒；取消或停权仅停止本机等待，不保证厂商停止任务或退款。</p>
      </>}
      {fields.slice(3).filter(field => (input.videoParserProvider || 'custom') === 'custom' || field.key !== 'videoParserEndpoint').map(renderField)}
    {(input.videoParserProvider || 'custom') === 'custom' && <details className="rounded-md border border-border p-4 text-xs text-foreground">
      <summary className="cursor-pointer font-semibold">内容提取高级配置（按厂商文档填写）</summary>
      <fieldset disabled={busy || !config} className="mt-4 grid gap-4 md:grid-cols-2">
        <label>请求方式
          <select name="videoParserOptions.method" className={inputClass} value={options.method}
            onChange={event => updateOption('method', event.target.value as VideoParserOptions['method'])}>
            <option value="POST">提交数据（POST / JSON）</option><option value="GET">查询参数（GET）</option>
          </select>
        </label>
        <label>鉴权方式
          <select name="videoParserOptions.authMode" className={inputClass} value={options.authMode}
            onChange={event => updateOption('authMode', event.target.value as VideoParserOptions['authMode'])}>
            <option value="bearer">令牌鉴权（Bearer）</option><option value="header">自定义请求头</option>
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
      <p className="mt-3 text-muted-foreground">字段路径从完整 JSON 响应开始填写，用点分隔，数组示例：data.items.0.text。文本路径留空时读取 data 或根对象中的 transcript / asr_text。接口须直接返回文本；仅返回视频或图片地址时，需由厂商提供转写或识别服务。</p>
    </details>}
    </fieldset>
    <p className="text-xs text-muted-foreground">连接测试使用已保存的模型配置。</p>
    <div className="flex flex-wrap gap-3">
      <button disabled={busy || !config} className="px-4 py-2 text-xs rounded-md bg-primary text-primary-foreground disabled:opacity-50">保存本设备接口配置</button>
      <button type="button" disabled={busy || !config} className="px-4 py-2 text-xs rounded-md border disabled:opacity-50" onClick={async () => {
        setBusy(true); setMessage('');
        try {
          const result = await window.electronAPI?.testLLMConnection({});
          if (!result?.success) showError(result?.message || result?.error || '模型连接失败，请检查已保存的接口地址、模型名称和密钥');
          else { const message = result.message || '模型连接成功'; setMessage(message); notifySuccess(message); }
        } catch { showError('模型连接请求失败，请检查网络和已保存的接口配置'); } finally { setBusy(false); }
      }}>测试模型连接</button>
    </div>
    {message && <p role="status" className="text-xs text-foreground">{message}</p>}
  </form>;
}
