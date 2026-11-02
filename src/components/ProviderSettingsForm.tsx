import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { notifyError, notifySuccess } from './ui/Toast';
import { useAuthStore } from '../store/useAuthStore';
import type { ProviderModule, ProviderSettings, ProviderSettingsInput } from '../../electron/services/providerTypes';
import { DEEPSEEK_PRESET, IMAGE_PRESETS, PROVIDER_MODULE_FIELDS } from '../../electron/services/providerConfig';
import { DEFAULT_VIDEO_PARSER_OPTIONS, type VideoParserOptions } from '../../electron/services/videoParserConfig';

const moduleTitles: Record<ProviderModule, string> = { llm: '智能二创', extraction: '内容提取', image: '图片生成' };
function editableConfig(config: ProviderSettings): ProviderSettingsInput {
  return { llmBaseUrl: config.llmBaseUrl, llmModel: config.llmModel, llmApiKey: '',
    videoParserEndpoint: config.videoParserEndpoint, videoParserApiKey: '', videoParserProvider: config.videoParserProvider || 'custom',
    videoParserOptions: { ...DEFAULT_VIDEO_PARSER_OPTIONS, ...config.videoParserOptions }, linkDigestMaxCredits: config.linkDigestMaxCredits ?? 5,
    imageProtocol: config.imageProtocol || 'agnes', imageEndpoint: config.imageEndpoint || IMAGE_PRESETS.agnes.imageEndpoint,
    imageModel: config.imageModel || config.agnesModel || IMAGE_PRESETS.agnes.imageModel, imageApiKey: '' };
}
function moduleValue(module: ProviderModule, input: ProviderSettingsInput) {
  return JSON.stringify(PROVIDER_MODULE_FIELDS[module].map(key => input[key]));
}
function ProviderModuleCard({ module, initial, onBusyChange }: {
  module: ProviderModule; initial: ProviderSettings; onBusyChange: (busy: boolean) => void;
}) {
  const [config, setConfig] = useState(initial);
  const [input, setInput] = useState(() => editableConfig(initial));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dirty = moduleValue(module, input) !== moduleValue(module, editableConfig(config));
  const configured = module === 'llm' ? config.llmKeyConfigured : module === 'image' ? config.imageKeyConfigured :
    config.videoKeyConfigured || ((config.videoParserProvider || 'custom') === 'custom' && config.videoParserOptions?.authMode === 'none' && !!config.videoParserEndpoint);
  const options = input.videoParserOptions || DEFAULT_VIDEO_PARSER_OPTIONS;
  const showError = (text: string) => { setMessage(text); notifyError(text, moduleTitles[module] + '配置未完成'); };
  const update = (patch: Partial<ProviderSettingsInput>) => { setInput(state => ({ ...state, ...patch })); setMessage(''); };
  function updateOption<K extends keyof VideoParserOptions>(key: K, value: VideoParserOptions[K]) {
    update({ videoParserOptions: { ...DEFAULT_VIDEO_PARSER_OPTIONS, ...input.videoParserOptions, [key]: value } });
  }
  function extractionPreset(provider: NonNullable<ProviderSettingsInput['videoParserProvider']>) {
    const endpoint = provider === 'linkdigest' ? 'https://linkdigest.dev' : provider === 'yaoan' ? 'https://cyanlis.cn' : '';
    update({ videoParserProvider: provider,
      videoParserApiKey: provider === input.videoParserProvider && input.videoParserEndpoint.replace(/\/+$/, '') === endpoint ? input.videoParserApiKey : '',
      videoParserEndpoint: endpoint,
      ...(provider === 'custom' ? { videoParserOptions: { ...DEFAULT_VIDEO_PARSER_OPTIONS } } : {}) });
  }
  const field = (key: 'llmBaseUrl' | 'llmModel' | 'llmApiKey' | 'videoParserEndpoint' | 'videoParserApiKey' | 'imageEndpoint' | 'imageModel' | 'imageApiKey', label: string, secret = false, placeholder = '') =>
    <label className="block space-y-1.5 text-sm" key={key}>{label}
      <input name={key} type={secret ? 'password' : 'text'} autoComplete="off" value={input[key] || ''}
        placeholder={secret ? '留空保留同一服务商已保存的密钥' : placeholder}
        onChange={event => update({ [key]: event.target.value })} className="field" />
    </label>;
  const presetClass = 'rounded-lg border px-3 py-2 text-xs text-accent-foreground disabled:opacity-50';
  return <form data-provider-module={module} className="space-y-4 rounded-xl border border-border p-4 sm:p-5" noValidate onSubmit={async event => {
    event.preventDefault(); setBusy(true); onBusyChange(true); setMessage('');
    try {
      const result = await window.electronAPI?.saveProviderModule({ module, config: input });
      if (!result?.success || !result.config) throw new Error(result?.error || '保存失败');
      setConfig(result.config); setInput(editableConfig(result.config));
      setMessage('本设备接口配置已加密保存'); notifySuccess(moduleTitles[module] + '配置已加密保存');
    } catch (error) { showError(error instanceof Error ? error.message : '保存接口配置失败'); }
    finally { setBusy(false); onBusyChange(false); }
  }}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{moduleTitles[module]}</h3>
      <span className="text-xs text-muted-foreground" role="status">{dirty ? '有未保存修改' : configured ? '已配置' : '未配置'}</span>
    </div>
    <fieldset disabled={busy} className="space-y-4">
      <div className="flex flex-wrap gap-2" aria-label={moduleTitles[module] + '快捷配置'}>
        {module === 'llm' && <><button type="button" className={presetClass} onClick={() => update({ ...DEEPSEEK_PRESET,
          llmApiKey: input.llmBaseUrl.replace(/\/+$/, '') === DEEPSEEK_PRESET.llmBaseUrl ? input.llmApiKey : '' })}>使用 DeepSeek 配置</button>
          <button type="button" className={presetClass} onClick={() => document.getElementsByName('llmBaseUrl')[0]?.focus()}>自定义接口</button></>}
        {module === 'image' && <>{(['agnes', 'seedream'] as const).map(provider => <button key={provider} type="button" className={presetClass}
          onClick={() => update({ ...IMAGE_PRESETS[provider], imageApiKey: input.imageProtocol === provider && input.imageEndpoint === IMAGE_PRESETS[provider].imageEndpoint ? input.imageApiKey : '' })}>
          使用 {provider === 'agnes' ? 'Agnes' : 'Seedream'} 配置</button>)}
          <button type="button" className={presetClass} onClick={() => document.getElementsByName('imageEndpoint')[0]?.focus()}>自定义兼容接口</button></>}
        {module === 'extraction' && <><button type="button" className={presetClass} onClick={() => extractionPreset('linkdigest')}>使用 LinkDigest 配置</button>
          <button type="button" className={presetClass} onClick={() => extractionPreset('yaoan')}>使用姚安配置</button>
          <button type="button" className={presetClass} onClick={() => extractionPreset('custom')}>自定义接口</button></>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {module === 'llm' && <><label className="block space-y-1.5 text-sm">接口类型<input className="field" value="OpenAI 兼容协议" readOnly /></label>
          {field('llmBaseUrl', '接口地址', false, '填写模型服务的基础地址')}{field('llmModel', '模型名称')}{field('llmApiKey', 'API Key', true)}</>}
        {module === 'image' && <><label className="block space-y-1.5 text-sm">接口协议
          <select name="imageProtocol" className="field" value={input.imageProtocol} onChange={event => update({ imageProtocol: event.target.value as ProviderSettingsInput['imageProtocol'], imageApiKey: '' })}>
            <option value="agnes">Agnes 兼容</option><option value="seedream">Seedream 兼容</option>
          </select></label>{field('imageEndpoint', '接口完整地址')}{field('imageModel', '模型名称')}{field('imageApiKey', 'API Key', true)}</>}
        {module === 'extraction' && <><label className="block space-y-1.5 text-sm">接口类型
          <select name="videoParserProvider" className="field" value={input.videoParserProvider} onChange={event => extractionPreset(event.target.value as NonNullable<ProviderSettingsInput['videoParserProvider']>)}>
            <option value="custom">自定义提取协议</option><option value="linkdigest">LinkDigest 兼容</option><option value="yaoan">姚安兼容</option>
          </select></label>{field('videoParserEndpoint', input.videoParserProvider === 'custom' ? '接口完整地址' : '接口基础地址')}{field('videoParserApiKey', 'API Key', true)}</>}
      </div>
      <details className="rounded-lg border border-border p-3 text-sm"><summary className="cursor-pointer font-medium">高级配置</summary>
        {module === 'llm' && <p className="mt-3 text-xs text-muted-foreground">使用 OpenAI 兼容的对话接口与流式输出。模型名称可填写服务商提供的模型标识。</p>}
        {module === 'image' && <p className="mt-3 text-xs text-muted-foreground">按所选协议提交图片请求。比例跟随图文草案，参考图支持原帖风格、按页素材和沿用当前图优化。
          {input.imageProtocol === 'seedream' ? 'Seedream 使用 2K 尺寸，单次最多 10 张参考图；模型须支持 Base64 图片返回。' : 'Agnes 使用 1K 尺寸，并区分文生图与参考图请求。'}</p>}
        {module === 'extraction' && input.videoParserProvider === 'linkdigest' && <label className="mt-3 block space-y-1.5">单次提取积分上限
          <input name="linkDigestMaxCredits" type="number" min={1} max={1000} step={1} className="field" value={input.linkDigestMaxCredits ?? 5}
            onChange={event => update({ linkDigestMaxCredits: Number(event.target.value) })} /></label>}
        {module === 'extraction' && input.videoParserProvider === 'yaoan' && <p className="mt-3 text-xs text-muted-foreground">根据抖音或小红书链接自动选择视频转文字路径，无需另配语音识别密钥。</p>}
        {module === 'extraction' && input.videoParserProvider === 'custom' && <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5">请求方式<select name="videoParserOptions.method" className="field" value={options.method} onChange={event => updateOption('method', event.target.value as VideoParserOptions['method'])}>
            <option value="POST">POST / JSON</option><option value="GET">GET / 查询参数</option></select></label>
          <label className="space-y-1.5">鉴权方式<select name="videoParserOptions.authMode" className="field" value={options.authMode} onChange={event => updateOption('authMode', event.target.value as VideoParserOptions['authMode'])}>
            <option value="bearer">Bearer</option><option value="header">自定义请求头</option><option value="query">查询参数</option><option value="none">无需密钥</option></select></label>
          {(options.authMode === 'header' || options.authMode === 'query') && <label className="space-y-1.5">密钥参数名<input name="videoParserOptions.apiKeyName" className="field" value={options.apiKeyName} maxLength={64} onChange={event => updateOption('apiKeyName', event.target.value)} /></label>}
          <label className="space-y-1.5">分享链接参数名<input name="videoParserOptions.urlField" className="field" value={options.urlField} maxLength={64} onChange={event => updateOption('urlField', event.target.value)} /></label>
          <label className="space-y-1.5">返回文本字段路径<input name="videoParserOptions.textPath" className="field" value={options.textPath} maxLength={256} placeholder="例如 data.audio_text" onChange={event => updateOption('textPath', event.target.value)} /></label>
          <label className="space-y-1.5">返回标题字段路径<input name="videoParserOptions.titlePath" className="field" value={options.titlePath} maxLength={256} placeholder="例如 data.title" onChange={event => updateOption('titlePath', event.target.value)} /></label>
          <label className="space-y-1.5">请求超时（秒）<input name="videoParserOptions.timeoutSeconds" type="number" min={1} max={300} step={1} className="field" value={options.timeoutSeconds} onChange={event => updateOption('timeoutSeconds', Number(event.target.value))} /></label>
          <p className="text-xs text-muted-foreground md:col-span-2">字段路径从完整 JSON 响应开始填写，例如 data.items.0.text；接口须直接返回文本或支持的图文内容。</p>
        </div>}
      </details>
      <p className="text-xs text-muted-foreground">快捷预设只填入表单，请保存本设备接口配置后使用。
        {module === 'llm' && '测试模型连接使用当前填写的配置，不会自动保存。'}</p>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">保存本设备接口配置</button>
        {module === 'llm' && <button type="button" className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50" onClick={async () => {
          setBusy(true); onBusyChange(true); setMessage('');
          try {
            const result = await window.electronAPI?.testProviderModule({ module, config: input });
            if (!result?.success) throw new Error(result?.message || result?.error || '连接测试失败');
            setMessage(result.message || '连接测试成功'); notifySuccess(result.message || '连接测试成功');
          } catch (error) { showError(error instanceof Error ? error.message : '连接测试失败'); }
          finally { setBusy(false); onBusyChange(false); }
        }}>{busy ? '处理中…' : '测试模型连接'}</button>}
      </div>
    </fieldset>
    {message && <p role="status" className="text-xs">{message}</p>}
  </form>;
}
export function ProviderSettingsForm() {
  const user = useAuthStore(state => state.user);
  const [config, setConfig] = useState<ProviderSettings | null>(null);
  const [error, setError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [revision, setRevision] = useState(0);
  const [pendingOperations, setPendingOperations] = useState(0);
  const cancelReset = useRef<HTMLButtonElement>(null);
  const reset = async () => {
    if (resetting || pendingOperations) return;
    setResetting(true); setResetError('');
    try {
      const result = await window.electronAPI?.resetProviderSettings();
      if (!result?.success || !result.config) throw new Error(result?.error || '清空接口配置失败');
      setConfig(result.config); setError(''); setRevision(value => value + 1); setResetOpen(false);
      notifySuccess('本设备 API 配置已清空，请重新填写并保存');
    } catch (error) {
      setResetError(error instanceof Error ? error.message : '清空接口配置失败，请重试');
    } finally { setResetting(false); }
  };
  useEffect(() => {
    let active = true; setConfig(null); setError('');
    if (user) void window.electronAPI?.getProviderSettings().then(result => {
      if (!active) return;
      if (result.success && result.config) setConfig(result.config);
      else setError(result.error || '读取本设备接口配置失败');
    }).catch(() => { if (active) setError('读取本设备接口配置失败，请重新打开设置后重试'); });
    return () => { active = false; };
  }, [user?.id]);
  if (!user) return <p className="text-sm text-muted-foreground">请先登录后配置本设备接口。</p>;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">配置仅保存在本设备，密钥加密保存。更换服务商时，请填写对应服务商的 API Key。</p>
      <Button size="sm" variant="danger" disabled={resetting || pendingOperations > 0 || (!config && !error)} onClick={() => { setResetError(''); setResetOpen(true); }}>清空 API 配置并重新填写</Button>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : config ?
      <fieldset disabled={resetting} className="min-w-0 space-y-5">
        {(['llm', 'extraction', 'image'] as const).map(module => <ProviderModuleCard key={user.id + module + revision} module={module} initial={config} onBusyChange={busy => setPendingOperations(count => count + (busy ? 1 : -1))} />)}
      </fieldset> : <p className="text-sm text-muted-foreground">正在读取接口配置…</p>}
    <Modal open={resetOpen} onOpenChange={setResetOpen} title="清空本设备 API 配置"
      description="将清除智能二创、内容提取、图片生成的已保存接口配置及密钥，清空后需要重新填写并保存。"
      centered busy={resetting} initialFocus={cancelReset}
      footer={<><Button ref={cancelReset} variant="ghost" disabled={resetting} onClick={() => setResetOpen(false)}>取消</Button>
        <Button variant="danger" disabled={resetting || pendingOperations > 0} onClick={() => { void reset(); }}>{resetting ? '正在清空…' : '确认清空'}</Button></>}>
      <p className="text-sm text-muted-foreground">清空后可使用快捷预设，或重新填写自定义接口。</p>
      {resetError && <p role="alert" className="text-sm text-destructive">{resetError}</p>}
    </Modal>
  </div>;
}
