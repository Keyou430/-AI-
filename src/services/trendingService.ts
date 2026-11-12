import type { HotspotFetchResult, HotspotItem, IndustryProfile } from '../types/trending';
import type { KnowledgeDocument, KeywordTag } from '../types';
import { fetchHotspotsClient, analyzeProfileWithLLMClient, rankHotspotsWithLLMClient } from './ipcClient';
export { getRealTopicUrl } from '../../electron/services/trendingLinks';

export const DEFAULT_PROFILES: Record<string, IndustryProfile> = {
  new_energy: {
    primaryIndustry: '新能源 / 智能出行与绿色能源',
    subCategories: ['新能源汽车', '动力电池', '800V高压快充', '冬季续航', '智能驾驶', '以旧换新补贴'],
    targetAudience: '关注续航达成率、安全性、快充效率与智能座舱的车主及科技尝鲜者',
    corePainPoints: ['冬季续航缩水', '充电排队慢', '保值率焦虑', '电池质保衰减', '车机系统卡顿'],
    suggestedAngles: ['硬核实测对比', '极限低温工况拆解', '用车成本真香算账', '选车用车避坑指南'],
    lastUpdated: Date.now(),
    isAutoDetected: false,
  },
  decoration: {
    primaryIndustry: '家居家装 / 空间设计与全屋定制',
    subCategories: ['全屋定制', '水电改造', '环保除甲醛', '小户型收纳', '极简风格', '装修避坑'],
    targetAudience: '正在装修或准备装修的刚需/改善型业主、旧房翻新家庭及空间美学爱好者',
    corePainPoints: ['隐蔽工程增项多', '板材甲醛超标', '施工延期扯皮', '实际效果翻车', '预算失控'],
    suggestedAngles: ['老工长现场验房', '施工红黑榜对比', '报价单增项拆解', '全屋改造前后大反转'],
    lastUpdated: Date.now(),
    isAutoDetected: false,
  },
  tech: {
    primaryIndustry: '数码科技 / 智能硬件与AI效率',
    subCategories: ['AI效率工具', '智能家居', '折叠屏手机', '数码装备', '生产力翻倍'],
    targetAudience: '20-40岁热衷科技新硬件、追求生产力效率与极客生活方式的科技爱好者',
    corePainPoints: ['工具学习成本高', '选择困难症', '生态协同繁琐'],
    suggestedAngles: ['降维打击对比', '小白闭眼入指南', '真香现场实录'],
    lastUpdated: Date.now(),
    isAutoDetected: false,
  },
  health: {
    primaryIndustry: '大健康 / 养生滋补与营养品',
    subCategories: ['熬夜调理', '中式滋补', '控糖轻体', '药食同源', '护肝明目'],
    targetAudience: '关注亚健康改善、经常加班熬夜的职场白领与家庭中坚',
    corePainPoints: ['精力不济易疲劳', '睡眠质量差', '外卖油腻肠胃负担', '想养生但怕繁琐'],
    suggestedAngles: ['反常识成分揭秘', '打工人真实翻包', '朋克养生吐槽转折', '专业医师视角避坑'],
    lastUpdated: Date.now(),
    isAutoDetected: false,
  },
  beauty: {
    primaryIndustry: '美妆个护 / 科学护肤与时尚穿搭',
    subCategories: ['敏感肌修护', '早C晚A', '通勤淡妆', '抗初老精华', '穿搭显瘦'],
    targetAudience: '注重外在形象、追求科学护肤与精致日常的年轻消费群体',
    corePainPoints: ['换季烂脸泛红', '跟风买到智商税', '妆容斑驳卡粉', '穿搭没风格'],
    suggestedAngles: ['成分党深度扒皮', '真人半脸实测', '早八人极速变美指南'],
    lastUpdated: Date.now(),
    isAutoDetected: false,
  },
  food: {
    primaryIndustry: '餐饮美食 / 本地生活与烘焙探店',
    subCategories: ['爆款私房菜', '减脂快手餐', '周末探店', '烘焙甜品', '一人食治愈'],
    targetAudience: '热爱美食生活、注重饮食口感与健康平衡的都市年轻群体',
    corePainPoints: ['做饭繁琐耗时', '外卖不卫生', '探店排队踩雷'],
    suggestedAngles: ['大厨不外传秘方', '厨房小白10分钟搞定', '避雷红黑榜'],
    lastUpdated: Date.now(),
    isAutoDetected: false,
  },
  general: {
    primaryIndustry: '综合商业 / 新媒体运营与品牌',
    subCategories: ['爆款打造', '品牌营销', '行业风向', '用户增长', '内容获客'],
    targetAudience: '新媒体运营人员、内容创作者与企业市场部',
    corePainPoints: ['流量见顶转化低', '缺少爆款选题', '创作效率低'],
    suggestedAngles: ['爆款逻辑拆解', '热点借势指南', '行业趋势洞察'],
    lastUpdated: Date.now(),
    isAutoDetected: false,
  },
};


export function industryContext(docs: KnowledgeDocument[], keywords: KeywordTag[]) {
  return {
    docSnippets: docs.filter(doc => doc.enabled).slice(0, 5).map(doc => (doc.name + ': ' + (doc.fullContent || doc.contentSnippet || '')).slice(0, 400)),
    keywords: keywords.filter(word => word.category !== 'forbidden').map(word => word.text.trim()).filter(Boolean).slice(0, 30),
  };
}

export function isTrendingAuthError(error: unknown): boolean {
  return error instanceof Error && ['AUTH_REQUIRED', 'ACCOUNT_DISABLED', 'AUTH_UNAVAILABLE', 'API_RESET_FAILED'].includes(error.name);
}

export async function detectIndustryProfile(docs: KnowledgeDocument[], keywords: KeywordTag[], fallback = DEFAULT_PROFILES.general): Promise<IndustryProfile> {
  const enabledDocs = docs.filter(doc => doc.enabled);
  const activeKeywords = industryContext(docs, keywords).keywords;
  if (!enabledDocs.length && !activeKeywords.length) return { ...fallback };
  try {
    return await analyzeProfileWithLLMClient(industryContext(docs, keywords));
  } catch (error) {
    if (isTrendingAuthError(error)) throw error;
  }
  // 2. 启发式行业自适应萃取
  const combinedText = [
    ...enabledDocs.map((d) => `${d.name} ${d.contentSnippet || ''} ${d.fullContent?.slice(0, 500) || ''}`),
    ...activeKeywords,
  ].join(' ').toLowerCase();

  // 各行业特征探测规则
  const isNewEnergy = /新能源|电池|光伏|储能|电动车|充电|续航|电车|汽车|车机|智驾|suv/.test(combinedText);
  const isDecoration = /装修|家装|设计|全屋|定制|水电|甲醛|瓷砖|吊顶|软装|家具|户型|板材|工长|验房/.test(combinedText);
  const isTech = /数码|芯片|科技|手机|折叠屏|电脑|生产力|硬件|智能体|算法/.test(combinedText);
  const isHealth = /健康|养生|原浆|滋补|护肝|中药|维生素|熬夜|调理|轻体/.test(combinedText);
  const isBeauty = /美妆|护肤|彩妆|抗衰|防晒|洁面|面霜|精华|底妆|穿搭|时尚/.test(combinedText);
  const isFood = /美食|餐饮|烘焙|火锅|咖啡|奶茶|探店|小吃|菜谱|做饭/.test(combinedText);

  let template = DEFAULT_PROFILES.general;
  if (isNewEnergy) template = DEFAULT_PROFILES.new_energy;
  else if (isDecoration) template = DEFAULT_PROFILES.decoration;
  else if (isTech) template = DEFAULT_PROFILES.tech;
  else if (isHealth) template = DEFAULT_PROFILES.health;
  else if (isBeauty) template = DEFAULT_PROFILES.beauty;
  else if (isFood) template = DEFAULT_PROFILES.food;

  // 构造精准 subCategories：优先使用用户上传的关键词
  const derivedCategories: string[] = [];
  if (activeKeywords.length > 0) {
    derivedCategories.push(...activeKeywords);
  }
  // 从文档标题提取核心词
  enabledDocs.forEach((d) => {
    const cleanName = d.name.replace(/\.[^/.]+$/, '').replace(/[\-_()（）]/g, ' ').trim();
    cleanName.split(/\s+/).forEach((part) => {
      if (part.length >= 2 && !derivedCategories.includes(part)) {
        derivedCategories.push(part);
      }
    });
  });

  // 如果依然不足，补充匹配到的行业模板核心词
  template.subCategories.forEach((cat) => {
    if (!derivedCategories.includes(cat) && derivedCategories.length < 8) {
      derivedCategories.push(cat);
    }
  });

  const primaryDoc = enabledDocs[0];
  const primaryTitle = primaryDoc ? primaryDoc.name.replace(/\.[^/.]+$/, '') : template.primaryIndustry;

  return {
    primaryIndustry: primaryDoc ? `自适应：${primaryTitle}` : template.primaryIndustry,
    subCategories: derivedCategories.slice(0, 8),
    targetAudience: template.targetAudience,
    corePainPoints: activeKeywords.length > 0 ? activeKeywords.slice(0, 4) : template.corePainPoints,
    suggestedAngles: template.suggestedAngles,
    lastUpdated: Date.now(),
    isAutoDetected: true,
    analysisMethod: 'rules',
  };
}


const INDUSTRY_TERMS: Array<[RegExp, RegExp]> = [
  [/新能源|汽车|电池|储能|光伏/, /新能源|汽车|车企|新车|纯电|混动|电池|充电|续航|快充|电车|超充|车机|智驾|自动驾驶|辅助驾驶|光伏|储能/],
  [/装修|家装|全屋|定制|家具/, /装修|家装|家居|家具|全屋|水电改造|甲醛|板材|工长|验房|精装房|户型|软装|收纳|橱柜|衣柜|门窗|卫浴|瓷砖|地板|墙漆/],
  [/数码|科技|智能硬件|人工智能|\bai\b/i, /科技|数码|折叠屏|人工智能|\bai\b|OpenAI|ChatGPT|智能硬件|智能家居|芯片|手机|电脑|软件|大模型/i],
  [/健康|养生|滋补|营养/, /健康|养生|熬夜|睡眠|滋补|控糖|营养|医疗|医药|中药|维生素|饮食调理/],
  [/美妆|护肤|穿搭/, /护肤|敏感肌|化妆|彩妆|卸妆|精华液|护肤精华|抗衰|美妆|穿搭|防晒|面霜|口红|粉底|护发/],
  [/美食|餐饮|烘焙/, /美食|餐饮|食品|烘焙|蛋糕|探店|咖啡|菜谱|菜肴|蔬菜|烹饪|做饭|奶茶|甜品|火锅|餐厅/],
  [/商业|品牌|营销|新媒体|运营/, /商业|品牌|营销|新媒体|用户增长|获客|电商|零售|消费|广告/],
];

export function rankHotspotsByRules(items: HotspotItem[], profile: IndustryProfile, forbidden: string[] = []): HotspotItem[] {
  const terms = [...new Set([...profile.subCategories, ...profile.corePainPoints].map(term => term.trim()).filter(Boolean))];
  const industry = (INDUSTRY_TERMS.find(([pattern]) => pattern.test(profile.primaryIndustry))
    || INDUSTRY_TERMS.find(([pattern]) => pattern.test(profile.subCategories.join(' '))))?.[1];
  return items.filter(item => !forbidden.some(word => word.trim() && item.title.toLowerCase().includes(word.trim().toLowerCase()))).map(item => {
    const matched = terms.filter(word => item.title.toLowerCase().includes(word.toLowerCase()));
    const industryMatch = industry ? item.title.match(industry)?.[0] : undefined;
    const categoryMatch = matched.some(word => profile.subCategories.includes(word));
    const score = industryMatch || categoryMatch ? Math.min(95, 65 + matched.length * 10) : Math.min(45, 20 + matched.length * 10);
    if (industryMatch && !matched.includes(industryMatch)) matched.push(industryMatch);
    return { ...item, relevanceScore: score, matchKeywords: matched, isHighMatch: score >= 75, analysisMethod: 'rules' as const,
      remixAngle: score >= 60 ? '围绕“' + item.title.slice(0, 60) + '”，从' + (matched[0] || profile.subCategories[0] || profile.primaryIndustry) + '切入，结合知识库已有事实提供实用建议。' : '该话题与当前业务关联较弱，建议核实关联后再创作。',
      suggestedHook: score >= 60 ? '关于' + item.title.slice(0, 24) + '，哪些问题与你有关？' : undefined };
  }).sort((a, b) => b.relevanceScore - a.relevanceScore || a.rank - b.rank);
}

export async function fetchTrendingHotspots(profile: IndustryProfile | null, force = false, forbidden: string[] = [], isCurrent: () => boolean = () => true): Promise<HotspotFetchResult & { analysisNotice?: string }> {
  const result = await fetchHotspotsClient({ force });
  if (!isCurrent() || !profile || !result.hotspots.length) return result;
  const candidates = rankHotspotsByRules(result.hotspots, profile, forbidden);
  const shortlist = candidates.filter(item => item.relevanceScore >= 60 && result.sources.some(source => source.platform === item.platform && source.status === 'fresh')).slice(0, 15);
  if (!shortlist.length) return { ...result, hotspots: candidates };
  try {
    const ranked = await rankHotspotsWithLLMClient({ profile, candidates: shortlist });
    const byId = new Map(ranked.map(item => [item.id, item]));
    return { ...result, hotspots: candidates.map(item => byId.get(item.id) || item).sort((a, b) => b.relevanceScore - a.relevanceScore || a.rank - b.rank),
      ...(!ranked.some(item => item.analysisMethod === 'ai') ? { analysisNotice: 'AI 未返回有效评分，当前按行业规则排序。' } : {}) };
  } catch (error) {
    if (isTrendingAuthError(error)) throw error;
    return { ...result, hotspots: candidates, analysisNotice: 'AI 精排暂不可用，当前按行业规则排序。请在设置中检查模型接口。' };
  }
}
