import { userFacingError } from './userFacingError';
/**
 * [Phase 1 & Phase 3] AI 与大模型集成层
 * - 采用 OpenAI 标准 Node.js SDK，兼容 DeepSeek/千问/豆包/Kimi/OpenAI 等 OpenAI 协议服务
 * - 接口地址、模型与密钥只来自主进程读取的本机加密配置，不使用内置默认值或环境变量
 * - 支持 Phase 3 多轮对话上下文 (conversationHistory)，并在发送前限制历史长度以控制 token 消耗
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

/** 多轮历史最多保留的消息条数（约 3 轮问答）。 */
export const MAX_HISTORY_MESSAGES = 6;
/** 历史中单条用户消息的保留字数：旧提示词包含素材与知识库全文，本轮提示词已重新注入，无需重复发送。 */
export const MAX_HISTORY_USER_CHARS = 1500;
/** 历史中单条模型回复（上一版脚本）的保留字数。 */
export const MAX_HISTORY_ASSISTANT_CHARS = 8000;
/** 历史消息总字数上限。 */
export const MAX_HISTORY_TOTAL_CHARS = 20000;

const OMITTED_USER_NOTE = '\n……（前序轮次的素材与知识库内容已省略，以本轮最新要求为准）……\n';

function truncateTurn(turn: ConversationTurn): ConversationTurn {
  if (turn.role === 'user') {
    if (turn.content.length <= MAX_HISTORY_USER_CHARS) return turn;
    // 保留开头的任务说明和结尾的修改指令，省略中间的素材与知识库全文。
    const head = Math.floor(MAX_HISTORY_USER_CHARS * 0.4);
    const tail = MAX_HISTORY_USER_CHARS - head;
    return { role: 'user', content: turn.content.slice(0, head) + OMITTED_USER_NOTE + turn.content.slice(-tail) };
  }
  if (turn.content.length <= MAX_HISTORY_ASSISTANT_CHARS) return turn;
  return { role: 'assistant', content: turn.content.slice(0, MAX_HISTORY_ASSISTANT_CHARS) + '\n……（上一版脚本过长，已截断）' };
}

/**
 * 校验并压缩多轮历史：丢弃非法条目，只保留最近若干条，旧用户提示词只保留首尾，
 * 总字数超限时从最早的消息开始丢弃。
 */
export function limitConversationHistory(history: unknown): ConversationTurn[] {
  if (!Array.isArray(history)) return [];
  const valid = history.filter((turn): turn is ConversationTurn =>
    !!turn && typeof turn === 'object' &&
    (turn.role === 'user' || turn.role === 'assistant') &&
    typeof turn.content === 'string' && turn.content.trim().length > 0);
  const kept: ConversationTurn[] = [];
  let total = 0;
  for (let index = valid.length - 1; index >= 0 && kept.length < MAX_HISTORY_MESSAGES; index--) {
    const turn = truncateTurn({ role: valid[index].role, content: valid[index].content });
    if (total + turn.content.length > MAX_HISTORY_TOTAL_CHARS) break;
    total += turn.content.length;
    kept.unshift(turn);
  }
  return kept;
}

function requireConfig(config: LLMConnectionConfig | undefined): LLMConnectionConfig {
  const apiKey = config?.apiKey?.trim() || '';
  const baseURL = config?.baseURL?.trim() || '';
  const model = config?.model?.trim() || '';
  if (!apiKey || !baseURL || !model) {
    throw new Error('请先在“系统设置 → API 接口配置”保存本设备的模型接口地址、模型名称和接口密钥。');
  }
  return { apiKey, baseURL, model };
}

export async function testLLMConnection(
  config: LLMConnectionConfig,
  onError?: (error: unknown) => void,
  signal?: AbortSignal
): Promise<{ success: boolean; message: string; latencyMs?: number }> {
  signal?.throwIfAborted();
  let resolved: LLMConnectionConfig;
  try {
    resolved = requireConfig(config);
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }

  const startTime = Date.now();
  try {
    const client = new OpenAI({ fetch: globalThis.fetch, apiKey: resolved.apiKey, baseURL: resolved.baseURL });

    await client.chat.completions.create({
      model: resolved.model,
      messages: [{ role: 'user', content: '请回复：连接成功' }],
      max_tokens: 16,
    }, { signal });

    const latencyMs = Date.now() - startTime;
    return {
      success: true,
      latencyMs,
      message: `连接成功（模型：${resolved.model}，响应耗时 ${latencyMs} 毫秒）`,
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
  const config = requireConfig(req.config);

  const client = new OpenAI({ fetch: globalThis.fetch, apiKey: config.apiKey, baseURL: config.baseURL });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: req.systemPrompt },
    ...limitConversationHistory(req.conversationHistory),
    { role: 'user', content: req.userPrompt },
  ];

  const stream = await client.chat.completions.create({
    model: config.model,
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
