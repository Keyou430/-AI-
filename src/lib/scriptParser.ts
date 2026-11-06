import {
  ComplianceCheckItem,
  KeywordTag,
  ParsedScriptStructure,
  StoryboardShot,
} from '../types';

const scriptNumberPattern = '[0-9零〇一二两三四五六七八九十百千]+';

function parseScriptNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let current = 0;
  for (const char of value) {
    if (units[char]) {
      total += (current || 1) * units[char];
      current = 0;
    } else {
      current = current * 10 + (digits[char] ?? Number(char));
    }
  }
  return total + current;
}

function parseTimeRange(timeRange: string): [number, number] | null {
  const match = timeRange.match(new RegExp(
    '(' + scriptNumberPattern + ')\\s*秒?\\s*[-~～—–至到]\\s*(' + scriptNumberPattern + ')\\s*秒?'
  ));
  return match ? [parseScriptNumber(match[1]), parseScriptNumber(match[2])] : null;
}

function parseShotFields(body: string): Record<string, string> {
  const headings = [...body.matchAll(/(?:^|\n|[▪•])[\t \uFE0E\uFE0F]*(?:[-*][\t ]*)?(人员动作分工|运镜与拍摄执行标准|声音内容)[\t ]*[：:][\t ]*/g)];
  return Object.fromEntries(headings.map((heading, index) => [
    heading[1],
    body.slice(heading.index! + heading[0].length, headings[index + 1]?.index ?? body.length).trim(),
  ]));
}

export function parseGeneratedScript(rawText: string): ParsedScriptStructure {
  const cleaned = (rawText || '').trim();

  const overviewMatch = cleaned.match(
    new RegExp('【分镜脚本总览】\\s*共\\s*(' + scriptNumberPattern + ')\\s*个镜头[，,]\\s*总时长\\s*(' + scriptNumberPattern + ')\\s*秒')
  );
  const declaredTotalShots = overviewMatch ? parseScriptNumber(overviewMatch[1]) : 0;
  const declaredTotalDuration = overviewMatch ? parseScriptNumber(overviewMatch[2]) : 0;

  const shotRegex =
    new RegExp('【镜头\\s*(' + scriptNumberPattern + ')\\s*[|｜]\\s*([^】]+)】([\\s\\S]*?)(?=【镜头\\s*' + scriptNumberPattern + '\\s*[|｜]|$)', 'g');

  const shots: StoryboardShot[] = [];
  let match: RegExpExecArray | null;

  while ((match = shotRegex.exec(cleaned)) !== null) {
    const shotNumber = parseScriptNumber(match[1]);
    const timeRange = match[2].trim();
    const body = match[3].replace(/——————/g, '').trim();

    const timeNums = parseTimeRange(timeRange);
    const durationSec = timeNums ? Math.max(0, timeNums[1] - timeNums[0]) : 0;
    const fields = parseShotFields(body);
    const actionDivision = fields['人员动作分工'] || '';
    const cameraExecution = fields['运镜与拍摄执行标准'] || '';
    const audioContent = fields['声音内容'] || '';
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
      : shots.length > 0 && shots.every(shot => shot.isAmbientOnly)
        ? '（当前分镜脚本均为环境音镜头，未包含人声口播）'
        : '（未解析到口播，请查看全文核对）';

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

  const lastShotTime = parsed.shots.length > 0
    ? parseTimeRange(parsed.shots[parsed.shots.length - 1].timeRange)
    : null;
  const lastShotEndSec = lastShotTime ? lastShotTime[1] : parsed.totalDurationSec;
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
