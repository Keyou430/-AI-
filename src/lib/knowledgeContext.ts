import type { KnowledgeDocument } from '../types';

/** 知识库注入提示词的总字数上限（中文约 1 字 ≈ 1 token，约 1.2 万 token）。 */
export const KNOWLEDGE_CONTEXT_CHAR_BUDGET = 12000;
/** 超出预算时，每个片段的目标字数。 */
export const KNOWLEDGE_CHUNK_CHARS = 800;

export interface KnowledgeQueryTerm {
  text: string;
  weight: number;
}

export interface KnowledgeQuery {
  /** 业务关键词、原帖标签等明确词语，按权重计分。 */
  terms: KnowledgeQueryTerm[];
  /** 本次素材文案、主营业务与修改意见等自由文本，用于按中文二元组匹配相关段落。 */
  text: string;
}

export interface KnowledgeContextResult {
  block: string;
  truncated: boolean;
  totalChars: number;
  includedChars: number;
}

interface Chunk {
  docIndex: number;
  chunkIndex: number;
  content: string;
  score: number;
}

const NO_KNOWLEDGE_TEXT = '（当前未启用额外本地知识库文档，请以本公司主营业务概述与核心业务关键词为准）';

function documentText(doc: KnowledgeDocument): string {
  return (doc.fullContent || doc.contentSnippet || '').trim();
}

/** 按空行、换行切段，再合并为不超过目标字数的片段；超长段落按字数硬切。 */
export function splitIntoChunks(content: string, size = KNOWLEDGE_CHUNK_CHARS): string[] {
  const paragraphs = content.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    for (let start = 0; start < paragraph.length; start += size) {
      const piece = paragraph.slice(start, start + size);
      if (current && current.length + 1 + piece.length > size) {
        chunks.push(current);
        current = piece;
      } else {
        current = current ? current + '\n' + piece : piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** 提取中文二元组与英文/数字词，用于粗粒度相关度匹配。 */
function queryGrams(text: string, limit = 400): Set<string> {
  const grams = new Set<string>();
  for (const run of text.match(/[\u4e00-\u9fff]+/gu) || []) {
    for (let i = 0; i + 1 < run.length && grams.size < limit; i++) grams.add(run.slice(i, i + 2));
  }
  for (const word of text.toLowerCase().match(/[a-z0-9]{2,}/g) || []) {
    if (grams.size >= limit) break;
    grams.add(word);
  }
  return grams;
}

function countOccurrences(haystack: string, needle: string, cap = 3): number {
  let count = 0;
  for (let index = haystack.indexOf(needle); index !== -1 && count < cap; index = haystack.indexOf(needle, index + needle.length)) count++;
  return count;
}

function scoreChunk(content: string, terms: KnowledgeQueryTerm[], grams: Set<string>): number {
  const lower = content.toLowerCase();
  let score = 0;
  for (const term of terms) score += term.weight * countOccurrences(lower, term.text);
  let gramHits = 0;
  for (const gram of grams) if (lower.includes(gram)) gramHits++;
  return score + gramHits * 0.2;
}

/**
 * 构建知识库注入块：
 * - 启用文档总字数不超过预算时，完整注入（与原行为一致）；
 * - 超出预算时，切片后按与本次素材、关键词的相关度排序，挑选片段直至预算用完，
 *   相同得分时优先各文档靠前的片段，保证多份文档都有机会被引用。
 */
export function buildKnowledgeContext(
  docs: KnowledgeDocument[],
  query: KnowledgeQuery,
  budget = KNOWLEDGE_CONTEXT_CHAR_BUDGET
): KnowledgeContextResult {
  const active = docs.filter((doc) => doc.enabled && documentText(doc));
  if (!active.length) return { block: NO_KNOWLEDGE_TEXT, truncated: false, totalChars: 0, includedChars: 0 };

  const totalChars = active.reduce((sum, doc) => sum + documentText(doc).length, 0);
  if (totalChars <= budget) {
    const block = active
      .map((doc, idx) => `--- 知识库文档 ${idx + 1}：《${doc.name}》 ---\n${documentText(doc)}`)
      .join('\n\n');
    return { block, truncated: false, totalChars, includedChars: totalChars };
  }

  const terms = query.terms
    .map((term) => ({ text: term.text.trim().toLowerCase(), weight: term.weight }))
    .filter((term) => term.text.length > 0);
  const grams = queryGrams(query.text);
  const chunks: Chunk[] = active.flatMap((doc, docIndex) =>
    splitIntoChunks(documentText(doc)).map((content, chunkIndex) => ({
      docIndex, chunkIndex, content, score: scoreChunk(content, terms, grams),
    })));

  const ranked = [...chunks].sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex || a.docIndex - b.docIndex);
  const selected = new Set<Chunk>();
  let used = 0;
  for (const chunk of ranked) {
    if (used + chunk.content.length > budget) continue;
    selected.add(chunk);
    used += chunk.content.length;
  }

  const sections: string[] = [];
  active.forEach((doc, docIndex) => {
    const picked = chunks.filter((chunk) => chunk.docIndex === docIndex && selected.has(chunk));
    if (!picked.length) return;
    const parts: string[] = [];
    picked.forEach((chunk, i) => {
      if (i > 0 && chunk.chunkIndex !== picked[i - 1].chunkIndex + 1) parts.push('……');
      parts.push(chunk.content);
    });
    sections.push(`--- 知识库文档 ${sections.length + 1}：《${doc.name}》（节选） ---\n${parts.join('\n')}`);
  });
  sections.push(`（已启用 ${active.length} 份知识库文档，共约 ${totalChars} 字，超出单次注入上限；已按与本次素材及业务关键词的相关度节选约 ${used} 字）`);

  return { block: sections.join('\n\n'), truncated: true, totalChars, includedChars: used };
}
