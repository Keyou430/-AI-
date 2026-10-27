import { userFacingError } from './userFacingError';
/**
 * [Phase 1 & Phase 3] AI 与大模型集成层
 * - 采用 OpenAI 标准 Node.js SDK，内置硬编码默认配置（DeepSeek 标准端点），支持动态切换千问/豆包/Kimi/OpenAI
 * - 支持 Phase 3 多轮对话上下文 (conversationHistory) 与本地知识库长文本注入
 * - 实现 Server-Sent Events (SSE) 流式输出
 */

import OpenAI from 'openai';
import { setTimeout as delay } from 'node:timers/promises';

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
  enableMockFallback?: boolean;
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

/**
 * 构建严格遵守 PRD V1.1 输出格式、编排规则、且深度融合“本公司业务 + 知识库 + 多轮修改指令”的仿真脚本
 */
export function buildBusinessAlignedMockScript(params: {
  durationSec: number;
  userCameraWork: string;
  companyBusinessProfile?: string;
  brandKeywords?: string[];
  refinementInstruction?: string;
  turnCount?: number;
}): string {
  const totalSec = params.durationSec > 0 ? params.durationSec : 18;
  const seg1End = Math.max(4, Math.floor(totalSec * 0.28));
  const seg2End = Math.max(seg1End + 4, Math.floor(totalSec * 0.65));
  const cameraSpec =
    params.userCameraWork?.trim() || '近景俯拍、特写推进、中景平视跟随';
  const brandWord =
    params.brandKeywords && params.brandKeywords.length > 0
      ? params.brandKeywords[0]
      : '零脂冷萃冻干咖啡';
  const bizDesc =
    params.companyBusinessProfile?.trim() ||
    '精品冷萃咖啡液与办公室便携冲调饮品';

  if (params.refinementInstruction) {
    const cleanInst = params.refinementInstruction
      .replace(/["'“”‘’()（）\[\]【】]/g, '')
      .slice(0, 18);
    return [
      `【分镜脚本总览】共3个镜头，总时长${totalSec}秒`,
      `——————`,
      `【镜头1 | 0-${seg1End}秒】`,
      `▪️人员动作分工：出镜人员在办公室工位前针对${cleanInst}呈现鲜明痛点状态并迅速拿出本公司${brandWord}，摄影师手持相机由斜上方切入抓拍开盒动作`,
      `▪️运镜与拍摄执行标准：景别为近景转特写，运镜手法采用${cameraSpec}，灯光为侧逆自然光配合柔光板补光，角度为四十五度俯拍角度`,
      `▪️声音内容：早八困倦效率低？结合咱们${bizDesc}方案，三十秒用${brandWord}快速唤醒全天状态！`,
      `——————`,
      `【镜头2 | ${seg1End}-${seg2End}秒】`,
      `▪️人员动作分工：出镜人员向装满冰块的玻璃杯内倒入清澈椰子水并注入${brandWord}原液形成漂亮琥珀分层，摄影师顺着水流方向同步平稳移动机位`,
      `▪️运镜与拍摄执行标准：景别为微距特写，运镜手法采用${cameraSpec}，灯光为侧向硬光突出液体通透质感，角度为平视微俯角`,
      `▪️声音内容：仅环境音，清脆的冰块碰撞声与咖啡液缓缓倾倒的流动声`,
      `——————`,
      `【镜头3 | ${seg2End}-${totalSec}秒】`,
      `▪️人员动作分工：出镜人员微笑举杯品尝${brandWord}并顺势打开电脑高效处理业务，摄影师伴随人物动作自然向后拉远定格桌面全景`,
      `▪️运镜与拍摄执行标准：景别为中景，运镜手法采用${cameraSpec}，灯光为柔和双侧主辅光，角度为正面平视角度`,
      `▪️声音内容：兼顾清爽口感与高效提神，现在体验${brandWord}开启你的高能职场节奏！`,
    ].join('\n');
  }

  return [
    `【分镜脚本总览】共3个镜头，总时长${totalSec}秒`,
    `——————`,
    `【镜头1 | 0-${seg1End}秒】`,
    `▪️人员动作分工：出镜人员在晨光办公桌前展示早起困倦状态随后拿出本公司核心产品${brandWord}，摄影师由桌面一侧向杯口方向平稳推进抓拍动作`,
    `▪️运镜与拍摄执行标准：景别为近景，运镜手法采用${cameraSpec}，灯光为柔和窗边自然光搭配暖色辅光，角度为四十五度俯视角度`,
    `▪️声音内容：每天早起状态困倦没精神？教你用咱们${brandWord}三十秒复刻高颜值消水肿冰美式！`,
    `——————`,
    `【镜头2 | ${seg1End}-${seg2End}秒】`,
    `▪️人员动作分工：出镜人员先倒入八分满零脂椰子水再沿冰块缓缓注入${brandWord}浓缩液展现本公司${bizDesc}品质细节，摄影师围绕杯身侧面捕捉液体分层光影变化`,
    `▪️运镜与拍摄执行标准：景别为特写，运镜手法采用${cameraSpec}，灯光为侧逆光勾勒杯壁水珠质感，角度为水平正侧角度`,
    `▪️声音内容：仅环境音，冰块撞击玻璃杯壁的清脆声与液体缓慢注入的流淌声`,
    `——————`,
    `【镜头3 | ${seg2End}-${totalSec}秒】`,
    `▪️人员动作分工：出镜人员拿起成品特调微笑品尝并顺势打开电脑进入专注办公状态，摄影师跟随人物抬手动作平滑移动至桌面全景`,
    `▪️运镜与拍摄执行标准：景别为中景，运镜手法采用${cameraSpec}，灯光为均匀主光加背景轮廓光，角度为正面平视角度`,
    `▪️声音内容：零脂轻负担且清甜回甘，让${brandWord}陪你开启高效专注的每一个工作日！`,
  ].join('\n');
}

export async function streamGenerateScript(
  req: LLMGenerateRequest,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted();
  const apiKey = req.config.apiKey?.trim() || DEFAULT_HARDCODED_LLM_CONFIG.apiKey;

  if (!req.enableMockFallback && !apiKey) {
    throw new Error('请先填写有效的模型接口密钥，或开启仿真模式。');
  }

  if (!req.enableMockFallback) {
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

  // 内置流式仿真输出（打字机效果）
  const mockResult = buildBusinessAlignedMockScript({
    durationSec: req.targetDurationSec,
    userCameraWork: req.userCameraWork,
    companyBusinessProfile: req.companyBusinessProfile,
    brandKeywords: req.brandKeywords,
    refinementInstruction: req.refinementInstruction,
    turnCount: req.conversationHistory?.length || 0,
  });

  const chars = Array.from(mockResult);
  let accumulated = '';
  const step = 4;
  for (let i = 0; i < chars.length; i += step) {
    signal?.throwIfAborted();
    const piece = chars.slice(i, i + step).join('');
    accumulated += piece;
    onChunk(piece);
    await delay(24, undefined, { signal });
  }
  return accumulated;
}
