import {
  ComplianceCheckItem,
  KeywordTag,
  ParsedScriptStructure,
  StoryboardShot,
} from '../types';

export function parseGeneratedScript(rawText: string): ParsedScriptStructure {
  const cleaned = (rawText || '').trim();

  const overviewMatch = cleaned.match(
    /【分镜脚本总览】\s*共\s*(\d+)\s*个镜头[，,]\s*总时长\s*(\d+)\s*秒/
  );
  const declaredTotalShots = overviewMatch ? Number(overviewMatch[1]) : 0;
  const declaredTotalDuration = overviewMatch ? Number(overviewMatch[2]) : 0;

  const shotRegex =
    /【镜头\s*(\d+)\s*[|｜]\s*([^】]+)】([\s\S]*?)(?=【镜头\s*\d+|$)/g;

  const shots: StoryboardShot[] = [];
  let match: RegExpExecArray | null;

  while ((match = shotRegex.exec(cleaned)) !== null) {
    const shotNumber = Number(match[1]);
    const timeRange = match[2].trim();
    const body = match[3].replace(/——————/g, '').trim();

    const timeNums = timeRange.match(/(\d+)\s*[-~至]\s*(\d+)/);
    const durationSec = timeNums
      ? Math.max(0, Number(timeNums[2]) - Number(timeNums[1]))
      : 0;

    const actionMatch = body.match(/▪️\s*人员动作分工[：:]([^▪️\n]+)/);
    const cameraMatch = body.match(/▪️\s*运镜与拍摄执行标准[：:]([^▪️\n]+)/);
    const audioMatch = body.match(/▪️\s*声音内容[：:]([^▪️\n]+)/);

    const actionDivision = actionMatch ? actionMatch[1].trim() : '';
    const cameraExecution = cameraMatch ? cameraMatch[1].trim() : '';
    const audioContent = audioMatch ? audioMatch[1].trim() : '';
    const isAmbientOnly = audioContent.startsWith('仅环境音');

    shots.push({
      shotNumber,
      timeRange,
      durationSec,
      actionDivision,
      cameraExecution,
      audioContent,
      isAmbientOnly,
    });
  }

  const shootingTechniquesSummary = shots.map((shot, idx) => {
    const nextShot = shots[idx + 1];
    const transitionAdvice = nextShot
      ? `由镜头${shot.shotNumber}动作尾帧自然切入镜头${nextShot.shotNumber}首帧，利用人物动作动线与光影变化衔接，严禁跳剪或一镜到底。`
      : `收尾镜头定格，保持呼吸感与自然环境光收束。`;

    return {
      shotNumber: shot.shotNumber,
      timeRange: shot.timeRange,
      cameraStandard: shot.cameraExecution || '待生成运镜与拍摄执行标准',
      transitionAdvice,
    };
  });

  const voiceoverSegments = shots.map((shot) => ({
    shotNumber: shot.shotNumber,
    timeRange: shot.timeRange,
    content: shot.audioContent,
    isAmbientOnly: shot.isAmbientOnly,
  }));

  const spokenLines = shots
    .filter((s) => s.audioContent && !s.isAmbientOnly)
    .map((s) => s.audioContent.replace(/^口播[：:]/, '').trim());

  const voiceoverFullText =
    spokenLines.length > 0
      ? spokenLines.join('\n\n')
      : '（当前分镜脚本均为环境音镜头，未包含人声口播）';

  return {
    rawText: cleaned,
    totalShots: declaredTotalShots || shots.length,
    totalDurationSec: declaredTotalDuration,
    shots,
    shootingTechniquesSummary,
    voiceoverFullText,
    voiceoverSegments,
  };
}

function hasUnclosedBrackets(text: string): boolean {
  const pairs: Record<string, string> = {
    '（': '）',
    '【': '】',
    '《': '》',
    '(': ')',
    '[': ']',
  };
  const closeToOpen: Record<string, string> = Object.fromEntries(
    Object.entries(pairs).map(([k, v]) => [v, k])
  );
  const stack: string[] = [];

  for (const ch of text) {
    if (pairs[ch]) {
      stack.push(ch);
    } else if (closeToOpen[ch]) {
      const last = stack.pop();
      if (last !== closeToOpen[ch]) {
        return true;
      }
    }
  }
  return stack.length > 0;
}

/**
 * PRD V1.1【输出前自查项】9项自动校验（含本公司业务关键词结合校验）
 */
export function runScriptComplianceChecks(
  parsed: ParsedScriptStructure,
  expectedDurationSec: number,
  userCameraWork: string,
  keywords?: KeywordTag[],
  companyBusinessProfile?: string
): ComplianceCheckItem[] {
  const raw = parsed.rawText;
  if (!raw) return [];

  const noSubtitleWord = !raw.includes('字幕');

  const lastShotEndMatch =
    parsed.shots.length > 0
      ? parsed.shots[parsed.shots.length - 1].timeRange.match(
          /(\d+)\s*[-~至]\s*(\d+)/
        )
      : null;
  const lastShotEndSec = lastShotEndMatch
    ? Number(lastShotEndMatch[2])
    : parsed.totalDurationSec;
  const durationMatched =
    parsed.totalDurationSec === expectedDurationSec &&
    lastShotEndSec === expectedDurationSec;

  const orderedAscending =
    parsed.shots.length >= 2 &&
    parsed.shots.every((s, idx) => s.shotNumber === idx + 1);

  const allThreeFieldsComplete =
    parsed.shots.length > 0 &&
    parsed.shots.every(
      (s) =>
        Boolean(s.actionDivision) &&
        Boolean(s.cameraExecution) &&
        Boolean(s.audioContent)
    );

  // 检查是否结合了本公司业务关键词或主营业务
  const brandWords = (keywords || [])
    .filter((k) => k.category === 'brand' || k.category === 'jargon')
    .map((k) => k.text);
  const hasBrandKeyword =
    brandWords.length === 0 ||
    brandWords.some((w) => raw.includes(w)) ||
    Boolean(companyBusinessProfile && raw.includes(companyBusinessProfile.slice(0, 4)));

  const hasEnglishQuotes = /["']/.test(raw);
  const unclosed = hasUnclosedBrackets(raw);
  const punctuationClean = !hasEnglishQuotes && !unclosed;

  const audioDurationMatched =
    parsed.shots.length > 0 &&
    parsed.shots.every((s) => {
      if (s.isAmbientOnly) return s.audioContent.length > 4;
      const maxReasonableChars = Math.max(18, s.durationSec * 8);
      return s.audioContent.length <= maxReasonableChars;
    });

  const normalizedUserCamera = userCameraWork.trim();
  const cameraReused =
    !normalizedUserCamera ||
    (parsed.shots.length > 0 &&
      parsed.shots.every((s) =>
        s.cameraExecution.includes(normalizedUserCamera)
      ));

  const startsClean = raw.startsWith('【分镜脚本总览】');

  return [
    {
      id: 'no-subtitle',
      label: '全文无“字幕”二字，确认画面无文字',
      passed: noSubtitleWord,
      detail: noSubtitleWord
        ? '已通过：未检测到“字幕”相关字段'
        : '检测到“字幕”字样，请点击优化剔除',
    },
    {
      id: 'duration-match',
      label: '总时长与用户输入的视频时长一致',
      passed: durationMatched,
      detail: durationMatched
        ? `已通过：总时长严格匹配 ${expectedDurationSec} 秒`
        : `目标 ${expectedDurationSec} 秒，当前总览为 ${parsed.totalDurationSec} 秒`,
    },
    {
      id: 'shot-order',
      label: '镜头按序号正序排列（禁止一镜到底）',
      passed: orderedAscending,
      detail: orderedAscending
        ? `已通过：共 ${parsed.shots.length} 个镜头正序递增`
        : '镜头序号不连续或仅单个镜头',
    },
    {
      id: 'three-fields',
      label: '每个镜头三字段完整',
      passed: allThreeFieldsComplete,
      detail: allThreeFieldsComplete
        ? '已通过：人员动作分工、运镜标准、声音内容均完整'
        : '部分镜头缺失必填字段',
    },
    {
      id: 'business-fusion',
      label: '已将原热点视频结构与本公司业务关键词自然结合',
      passed: hasBrandKeyword,
      detail: hasBrandKeyword
        ? '已通过：已深度融入本公司主营业务场景与核心产品词'
        : '未检测到本公司核心业务词，建议点击优化强化业务关联',
    },
    {
      id: 'punctuation',
      label: '无英文双引号、英文单引号、未闭合括号',
      passed: punctuationClean,
      detail: punctuationClean
        ? '已通过：纯中文全角标点且括号全部闭合'
        : '检测到英文引号或未闭合括号',
    },
    {
      id: 'voice-duration',
      label: '口播时长与镜头时长匹配，不匹配则改为环境音',
      passed: audioDurationMatched,
      detail: audioDurationMatched
        ? '已通过：各镜头口播字数与环境音配置合理'
        : '部分镜头口播字数超出对应时长承载范围',
    },
    {
      id: 'camera-reuse',
      label: '运镜百分百复用用户输入',
      passed: cameraReused,
      detail: cameraReused
        ? '已通过：已100%复用用户输入的运镜信息'
        : '部分镜头未完整包含用户输入的运镜描述',
    },
    {
      id: 'no-extra-text',
      label: '只输出分镜脚本本身，无任何多余内容',
      passed: startsClean,
      detail: startsClean
        ? '已通过：无开场白或多余解释'
        : '检测到多余前缀或备注内容',
    },
  ];
}
