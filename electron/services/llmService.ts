import { userFacingError } from './userFacingError';
/**
 * [Phase 1 & Phase 3] AI 与大模型集成层
 * - 采用 OpenAI 标准 Node.js SDK，内置硬编码默认配置（DeepSeek 标准端点），支持动态切换千问/豆包/Kimi/OpenAI
 * - 支持 Phase 3 多轮对话上下文 (conversationHistory) 与本地知识库长文本注入
 * - 实现 Server-Sent Events (SSE) 流式输出
 */

import OpenAI from 'openai';

export interface LLMConnectionConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMGenerateRequest {
  requestId: string;
  config: LLMConnectionConfig;
  systemPrompt: string;
  userPrompt: string;
  conversationHistory?: ConversationTurn[];
  targetDurationSec: number;
  userCameraWork: string;
  companyBusinessProfile?: string;
  brandKeywords?: string[];
  refinementInstruction?: string;
}

// Phase 1 硬编码默认大模型配置（可在设置页被用户输入覆盖）
export const DEFAULT_HARDCODED_LLM_CONFIG: LLMConnectionConfig = {
  apiKey: process.env.LLM_API_KEY || '',
  baseURL: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
};

export async function testLLMConnection(
  config: LLMConnectionConfig,
  onError?: (error: unknown) => void,
  signal?: AbortSignal
): Promise<{ success: boolean; message: string; latencyMs?: number }> {
  signal?.throwIfAborted();
  const apiKey = config.apiKey?.trim() || DEFAULT_HARDCODED_LLM_CONFIG.apiKey;
  if (!apiKey) {
    return {
      success: false,
      message: '请先填写有效的模型接口密钥，再测试真实连接。',
    };
  }

  const startTime = Date.now();
  try {
    const client = new OpenAI({
      fetch: globalThis.fetch,
      apiKey,
      baseURL: config.baseURL?.trim() || DEFAULT_HARDCODED_LLM_CONFIG.baseURL,
    });

    await client.chat.completions.create({
      model: config.model?.trim() || DEFAULT_HARDCODED_LLM_CONFIG.model,
      messages: [{ role: 'user', content: '请回复：连接成功' }],
      max_tokens: 16,
    }, { signal });

    const latencyMs = Date.now() - startTime;
    return {
      success: true,
      latencyMs,
      message: `连接成功（模型：${config.model}，响应耗时 ${latencyMs} 毫秒）`,
    };
  } catch (err: unknown) {
    signal?.throwIfAborted();
    onError?.(err);
    return {
      success: false,
      message: userFacingError(err, '连接失败，请检查接口密钥、接口地址与网络环境。'),
    };
  }
}

export async function streamGenerateScript(
  req: LLMGenerateRequest,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted();
  const apiKey = req.config.apiKey?.trim() || DEFAULT_HARDCODED_LLM_CONFIG.apiKey;

  if (!apiKey) {
    throw new Error('请先在设置中保存有效的模型接口密钥。');
  }

  const client = new OpenAI({
    fetch: globalThis.fetch,
    apiKey,
    baseURL: req.config.baseURL?.trim() || DEFAULT_HARDCODED_LLM_CONFIG.baseURL,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: req.systemPrompt },
    ...(req.conversationHistory || []),
    { role: 'user', content: req.userPrompt },
  ];

  const stream = await client.chat.completions.create({
    model: req.config.model?.trim() || DEFAULT_HARDCODED_LLM_CONFIG.model,
    messages,
    temperature: 0.4,
    stream: true,
  }, { signal });

  let fullText = '';
  for await (const part of stream) {
    signal?.throwIfAborted();
    const delta = part.choices?.[0]?.delta?.content || '';
    if (delta) {
      fullText += delta;
      onChunk(delta);
    }
  }
  signal?.throwIfAborted();
  return fullText;
}
