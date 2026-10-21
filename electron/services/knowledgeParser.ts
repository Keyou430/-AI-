import fs from 'fs/promises';
import path from 'path';

export interface ParsedLocalKnowledgeFile {
  name: string;
  filePath: string;
  fileType: string;
  sizeBytes: number;
  fullContent: string;
  contentSnippet: string;
  charCount: number;
}

export async function parseLocalKnowledgeFile(filePath: string): Promise<ParsedLocalKnowledgeFile> {
  const buffer = await fs.readFile(filePath);
  const document = await parseKnowledgeBuffer({ name: path.basename(filePath), sizeBytes: buffer.length, buffer });
  return { ...document, filePath };
}

export async function parseKnowledgeBuffer(params: {
  name: string;
  sizeBytes: number;
  buffer: Buffer;
}): Promise<ParsedLocalKnowledgeFile> {
  const ext = path.extname(params.name).toLowerCase();
  let extractedText: string;
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const result = await pdfParse(new Uint8Array(params.buffer));
    extractedText = result.text || '';
  } else if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: params.buffer });
    extractedText = result.value || '';
  } else if (['.txt', '.md', '.csv', '.json'].includes(ext)) {
    extractedText = params.buffer.toString('utf-8');
  } else {
    throw new Error('不支持此文件格式，请选择 PDF、DOCX、TXT、MD、CSV 或 JSON 文档');
  }
  const fullContent = extractedText.replace(/\r\n/g, '\n').trim();
  if (!fullContent) throw new Error('文档未提取到文本，请检查内容；扫描版 PDF 需先进行文字识别');
  return {
    name: params.name, filePath: 'local-upload://' + params.name,
    fileType: ext.slice(1), sizeBytes: params.buffer.length,
    fullContent, charCount: fullContent.length,
    contentSnippet: fullContent.slice(0, 260).replace(/\s+/g, ' ') + (fullContent.length > 260 ? '...' : ''),
  };
}
