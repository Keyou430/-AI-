import type { ProviderModule, ProviderSettingsInput, ProviderTestResult } from './providerTypes';
import { testLLMConnection } from './llmService';
import { parseShortVideoLink } from './videoParser';
import { requestProviderImage } from './imageGenerationService';
import { imageMime } from './imageTextAssets';

export async function testProviderConnection(module: ProviderModule, config: ProviderSettingsInput,
  rawInput: string | undefined, signal: AbortSignal): Promise<ProviderTestResult> {
  signal.throwIfAborted();
  if (module === 'llm') {
    if (!config.llmApiKey || !config.llmBaseUrl || !config.llmModel) throw new Error('请完整填写文本模型地址、模型和密钥。');
    const result = await testLLMConnection({ apiKey: config.llmApiKey, baseURL: config.llmBaseUrl, model: config.llmModel }, undefined, signal);
    signal.throwIfAborted(); return result;
  }
  if (module === 'extraction') {
    if (!rawInput?.trim()) throw new Error('请填写用于测试的分享链接。');
    const result = await parseShortVideoLink({ rawInput, apiEndpoint: config.videoParserEndpoint, apiKey: config.videoParserApiKey,
      apiProvider: config.videoParserProvider, apiOptions: config.videoParserOptions, linkDigestMaxCredits: config.linkDigestMaxCredits }, undefined, signal);
    signal.throwIfAborted();
    return { success: result.success, message: result.success ? '内容提取测试成功。' : result.errorMessage || '内容提取测试失败。' };
  }
  if (module !== 'image') throw new Error('接口模块无效。');
  const bytes = await requestProviderImage(config, { prompt: '生成一张白色背景的蓝色陶瓷杯静物图片，正方形构图，不添加文字。', ratio: '1:1', references: [] }, signal);
  signal.throwIfAborted();
  return { success: true, message: '图片生成测试成功。', preview: 'data:' + imageMime(bytes) + ';base64,' + bytes.toString('base64') };
}
