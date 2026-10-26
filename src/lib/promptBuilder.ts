import { KeywordTag, KnowledgeDocument, ParsedVideoInfo } from '../types';

export interface BuildPromptInput {
  videoInfo: ParsedVideoInfo;
  editedTranscript: string;
  editedVisualSummary: string;
  targetDurationSec: number;
  userCameraWork: string;
  companyBusinessProfile: string;
  keywords: KeywordTag[];
  knowledgeDocs: KnowledgeDocument[];
  refinementInstruction?: string;
}

/**
 * [Phase 1 & Phase 3 & PRD V1.1]
 * 构建融合“热点视频流量骨架 + 本公司主营业务 + 本地知识库全文 (RAG) + 多轮对话修改指令”的 System Prompt 与 User Prompt
 */
export function buildSystemPrompt(): string {
  return `你是一位资深短视频编导与企业商业二创脚本专家。你的核心任务是：拆解用户提供的【当下热点视频】的黄金前3秒切入钩子、叙事节奏与情绪爽点，并将其深度嫁接至【本公司主营业务、核心产品关键词与企业本地知识库】上，输出高转化率的商业二创分镜脚本。

【输出格式】
【分镜脚本总览】共X个镜头，总时长XX秒
——————
【镜头X | 时长区间】
▪️人员动作分工：写明谁在哪里做什么，出镜人员与摄影师的动作均需描述清楚（需自然融入本公司业务场景或产品交互动作）
▪️运镜与拍摄执行标准：按景别、运镜手法、灯光、角度逐项写明，且必须百分百复用用户输入的运镜信息
▪️声音内容：有口播时写概要化口播文本（结合原热点切入方式与本公司核心业务卖点）；无口播时写“仅环境音”并描述具体环境音
——————

【脚本编排规则】
1. 根据视频总时长灵活拆分镜头，按抖音节奏排列，镜头序号严格正序递增，时间不足时不强行拆分
2. 禁止一镜到底，镜头之间通过光影变化或人物动线衔接，确保首帧连贯不跳脱
3. 热点与本公司业务深度融合：提取原热点视频的吸睛钩子、叙事结构与情绪痛点，无缝迁移至【设置页】所配置的“本公司主营业务”、“业务关键词”与“企业知识库”场景中，做到借势热点且业务属性鲜明，严禁生搬硬套或脱离本公司主营业务自说自话
4. 口播稿必须严格匹配对应镜头时长；若时长不足或不适合口播，则不写口播，只标注环境音
5. 纯中文输出，使用中文全角标点，严禁出现英文双引号、英文单引号、未闭合括号
6. 绝对禁止出现“字幕”二字及其他相关字段，视频画面中不得出现任何文字元素
7. 只输出分镜脚本本身，不写任何多余内容，包括解释、开场白、备注等`;
}

export function buildUserPrompt(input: BuildPromptInput): string {
  const {
    videoInfo,
    editedTranscript,
    editedVisualSummary,
    targetDurationSec,
    userCameraWork,
    companyBusinessProfile,
    keywords,
    knowledgeDocs,
    refinementInstruction,
  } = input;

  const brandWords = keywords
    .filter((k) => k.category === 'brand')
    .map((k) => k.text);
  const jargonWords = keywords
    .filter((k) => k.category === 'jargon')
    .map((k) => k.text);
  const forbiddenWords = keywords
    .filter((k) => k.category === 'forbidden')
    .map((k) => k.text);

  // Phase 3: 将启用的本地知识库完整解析文本 (fullContent) 通过长上下文拼接注入 Prompt
  const activeDocs = knowledgeDocs.filter((d) => d.enabled);
  const knowledgeContextBlock =
    activeDocs.length > 0
      ? activeDocs
          .map(
            (doc, idx) =>
              `--- 知识库文档 ${idx + 1}：《${doc.name}》 ---\n${
                doc.fullContent || doc.contentSnippet
              }`
          )
          .join('\n\n')
      : '（当前未启用额外本地知识库文档，请以本公司主营业务概述与核心业务关键词为准）';

  const lines: string[] = [
    `请基于以下【原热点视频提取/人工修订内容】与【本公司业务及本地知识库配置】，生成商业二创分镜脚本：`,
    ``,
    `================ 一、原热点视频信息（借势源） ================`,
    `1. 原视频来源平台：${videoInfo.platform === 'douyin' ? '抖音' : '小红书'}`,
    `2. 生效的原视频口播文案（含人工修订）：${editedTranscript || videoInfo.transcript}`,
    `3. 生效的原片画面与镜头概述（含人工修订）：${editedVisualSummary || '未提供画面描述'}`,
    ...(videoInfo.publishedText ? [`原视频发布文案（仅作背景，以人工修订后的口播为准）：${videoInfo.publishedText}`] : []),
    ``,
    `================ 二、本公司主营业务与关键词约束 ================`,
    `4. 本公司主营业务概述：${companyBusinessProfile || '精品冷萃咖啡液与办公室便携冲调饮品'}`,
    `5. 必须自然植入的核心业务/产品词：${brandWords.length > 0 ? brandWords.join('、') : '无特殊指定'}`,
    `6. 推荐融合的目标客群痛点与转化卖点词：${jargonWords.length > 0 ? jargonWords.join('、') : '无特殊指定'}`,
    `7. 严禁出现的违禁词：${[...forbiddenWords, '字幕'].join('、')}`,
    ``,
    `================ 三、本地企业知识库全文注入 (Phase 3 RAG) ================`,
    knowledgeContextBlock,
    ``,
    `================ 四、硬性拍摄参数要求 ================`,
    `8. 用户设定视频总时长：${targetDurationSec}秒（【分镜脚本总览】中的总时长必须严格等于${targetDurationSec}秒，且最后一个镜头结束秒数必须为${targetDurationSec}秒）`,
    `9. 用户指定运镜信息：${userCameraWork}（每个镜头的“▪️运镜与拍摄执行标准”中必须百分百完整包含“${userCameraWork}”这段文字）`,
  ];

  if (refinementInstruction && refinementInstruction.trim()) {
    lines.push(
      ``,
      `================ 五、本轮多轮对话迭代修改指令 ================`,
      `用户最新修改意见：${refinementInstruction.trim()}`,
      `请在保留前序脚本核心结构优势、严格满足所有格式规范与自查要求的前提下，针对上述修改意见重新输出完整分镜脚本。`
    );
  }

  lines.push(
    ``,
    `请直接输出符合【输出格式】的分镜脚本正文，不要输出任何开场白、解释或结尾备注。`
  );

  return lines.join('\n');
}
