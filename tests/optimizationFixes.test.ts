import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { limitConversationHistory } from '../electron/services/llmService';
import { buildKnowledgeContext, splitIntoChunks } from '../src/lib/knowledgeContext';
import { writeFileAtomicSync } from '../electron/db/sqliteService';
import type { KnowledgeDocument } from '../src/types';

// ============================================================================
// 优化项 1 测试：知识库字数预算与相关度节选、多轮历史长度与字数截断
// ============================================================================

test('优化项1: 知识库未超预算时完整注入，超预算时按业务关键词与相关度节选', () => {
  const docs: KnowledgeDocument[] = [
    {
      id: 'doc-1',
      name: '冷萃咖啡产品手册',
      sizeBytes: 100,
      uploadedAt: '',
      enabled: true,
      contentSnippet: '',
      fullContent: '本公司主营精品冷萃咖啡液，核心优势是低温慢萃与消水肿功效，保留丰富花果香。'.repeat(100), // ~3700字
    },
    {
      id: 'doc-2',
      name: '无关通用规范',
      sizeBytes: 100,
      uploadedAt: '',
      enabled: true,
      contentSnippet: '',
      fullContent: '办公室日常考勤制度与差旅报销流程规范说明。'.repeat(100), // ~2100字
    },
    {
      id: 'doc-3',
      name: '未启用的文档',
      sizeBytes: 100,
      uploadedAt: '',
      enabled: false,
      contentSnippet: '',
      fullContent: '绝密产品配方，禁止外传。',
    },
  ];

  // 1. 低预算测试（预算设为 1200 字，两份启用文档共 ~5800 字）
  const result = buildKnowledgeContext(
    docs,
    {
      terms: [{ text: '冷萃咖啡', weight: 5 }, { text: '消水肿', weight: 3 }],
      text: '早起消水肿喝什么？冷萃咖啡推荐。',
    },
    1200
  );

  assert.equal(result.truncated, true);
  assert.ok(result.includedChars <= 1200);
  assert.ok(result.block.includes('冷萃咖啡产品手册'));
  assert.ok(result.block.includes('低温慢萃'));
  assert.ok(!result.block.includes('未启用的文档'));
  assert.ok(!result.block.includes('绝密产品配方'));

  // 2. 充足预算测试：全量注入不被节选
  const generous = buildKnowledgeContext(
    docs,
    { terms: [], text: '' },
    20000
  );
  assert.equal(generous.truncated, false);
  assert.ok(generous.block.includes('冷萃咖啡产品手册'));
  assert.ok(generous.block.includes('无关通用规范'));
  assert.ok(!generous.block.includes('未启用的文档'));
});

test('优化项1: splitIntoChunks 段落切片按目标长度合理拆分', () => {
  const text = '第一段文字内容。\n\n第二段文字内容，比较长一点。'.repeat(50);
  const chunks = splitIntoChunks(text, 200);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 400); // 单个 chunk 不超过大致预算
  }
});

test('优化项1: 多轮历史限制保留最近轮次并压缩旧的用户提示词', () => {
  const turns = [
    { role: 'user' as const, content: '第1轮用户要求：' + '超长知识库'.repeat(500) },
    { role: 'assistant' as const, content: '第1轮脚本：镜头1……' },
    { role: 'user' as const, content: '第2轮修改意见：把镜头2换成近景。' },
    { role: 'assistant' as const, content: '第2轮脚本：镜头1……镜头2改为近景……' },
    { role: 'user' as const, content: '第3轮修改意见：增加环境音。' },
    { role: 'assistant' as const, content: '第3轮脚本：增加环境音……' },
    { role: 'user' as const, content: '第4轮修改意见：时长压缩到15秒。' },
    { role: 'assistant' as const, content: '第4轮脚本：最终15秒版……' },
  ];

  const limited = limitConversationHistory(turns);
  // 最多保留 6 条消息
  assert.ok(limited.length <= 6);
  // 最旧的超长用户提示词应该被截断或丢弃
  const oldestUser = limited.find((t) => t.role === 'user');
  if (oldestUser && oldestUser.content.includes('超长知识库')) {
    assert.ok(oldestUser.content.length <= 2000);
    assert.ok(oldestUser.content.includes('已省略'));
  }
  // 最新的指令完整保留
  assert.equal(limited[limited.length - 1].content, '第4轮脚本：最终15秒版……');
});

// ============================================================================
// 优化项 2 测试：模型接口配置校验
// ============================================================================

test('优化项2: llmService 拒绝不完整或空的接口配置', async () => {
  const { testLLMConnection, streamGenerateScript } = await import('../electron/services/llmService');

  // 空配置直接拒绝
  const testRes = await testLLMConnection({ apiKey: '', baseURL: '', model: '' });
  assert.equal(testRes.success, false);
  assert.ok(testRes.message.includes('系统设置'));

  // 缺少 baseURL
  const missingBaseUrl = await testLLMConnection({ apiKey: 'key', baseURL: '', model: 'gpt' });
  assert.equal(missingBaseUrl.success, false);

  // stream 同样抛出友好提示，不回退到默认环境变量
  await assert.rejects(
    streamGenerateScript(
      {
        requestId: 'req-test',
        config: { apiKey: '', baseURL: '', model: '' },
        systemPrompt: '',
        userPrompt: '',
        targetDurationSec: 15,
        userCameraWork: '',
      },
      () => {}
    ),
    /系统设置/
  );
});

// ============================================================================
// 优化项 4 测试：数据库原子写入 (writeFileAtomicSync)
// ============================================================================

test('优化项4: writeFileAtomicSync 安全覆盖原文件并确保原子落盘', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-test-'));
  const targetFile = path.join(tempDir, 'test-database.sqlite');

  try {
    // 首次写入
    const firstContent = Buffer.from('SQLite format 3\0-initial-database-data');
    writeFileAtomicSync(targetFile, firstContent);
    assert.ok(fs.existsSync(targetFile));
    assert.deepEqual(fs.readFileSync(targetFile), firstContent);

    // 覆盖写入
    const updatedContent = Buffer.from('SQLite format 3\0-updated-database-data-second-round');
    writeFileAtomicSync(targetFile, updatedContent);
    assert.deepEqual(fs.readFileSync(targetFile), updatedContent);

    // 确保没有残留的 .tmp 文件
    const files = fs.readdirSync(tempDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp'));
    assert.equal(tmpFiles.length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
