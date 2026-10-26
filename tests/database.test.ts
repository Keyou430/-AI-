import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AuthService } from '../electron/services/authService';
import { LocalSQLiteManager } from '../electron/db/sqliteService';

test('首次数据库初始化完成并可读取历史记录', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-remix-db-'));
  const db = new LocalSQLiteManager(directory);
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([db.ensureInitialized(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('数据库初始化超时')), 3000);
    })]);
    const records = await db.listRecords();
    assert.equal(records.length, 1);
  } finally {
    clearTimeout(timer!);
    db.close();
    await fs.rm(directory, {recursive:true, force:true});
  }
});


test('账号初始化、密码哈希、权限、会话撤销与停用拦截', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-remix-auth-'));
  const db = new LocalSQLiteManager(directory);
  const auth = new AuthService(db);
  try {
    assert.equal((await auth.status(1)).needsSetup, true);
    await assert.rejects(auth.requireUser(1), {code:'AUTH_REQUIRED'});
    await assert.rejects(auth.setup(1, 'short', '管理员'), {code:'INVALID_PASSWORD'});
    const admin = await auth.setup(1, 'admin-test-password', '管理员');
    assert.equal(admin.username,'admin');
    assert.equal('password_hash' in admin,false);
    const stored = db.findUser('username','admin')!;
    assert.notEqual(stored.password_hash,'admin-test-password');
    assert.equal(stored.salt.length,32);
    assert.equal(stored.password_hash.length,128);
    await assert.rejects(auth.setup(2, 'another-password', '重复管理员'), {code:'ALREADY_INITIALIZED'});
    await assert.rejects(auth.login(3,'admin','wrong-password'), {code:'INVALID_CREDENTIALS'});
    await assert.rejects(auth.setActive(1,admin.id,false), {code:'PROTECTED_ACCOUNT'});
    const member = await auth.createUser(1,{username:'member',password:'member-test-password',displayName:'成员',role:'member'});
    const secondAdmin = await auth.createUser(1,{username:'admin2',password:'admin2-test-password',displayName:'另一管理员',role:'admin'});
    assert.notEqual(db.findUser('id',member.id)!.salt,stored.salt);
    await assert.rejects(auth.createUser(1,{username:'member',password:'member-test-password',displayName:'重复',role:'member'}), {code:'USERNAME_EXISTS'});
    await auth.login(2,'member','member-test-password');
    await assert.rejects(auth.listUsers(2),{code:'FORBIDDEN'});
    await assert.rejects(auth.createUser(2,{username:'hacker',password:'member-test-password',displayName:'越权',role:'admin'}),{code:'FORBIDDEN'});
    await assert.rejects(auth.setActive(2,admin.id,false),{code:'FORBIDDEN'});
    await assert.rejects(auth.resetPassword(2,admin.id,'attacker-password'),{code:'FORBIDDEN'});
    await auth.login(4,'admin2','admin2-test-password');
    await assert.rejects(auth.setActive(4,secondAdmin.id,false),{code:'PROTECTED_ACCOUNT'});
    await auth.setActive(1,member.id,false);
    await assert.rejects(auth.requireUser(2),{code:'AUTH_REQUIRED'});
    await assert.rejects(auth.login(2,'member','member-test-password'),{code:'ACCOUNT_DISABLED'});
    await auth.setActive(1,member.id,true);
    await assert.rejects(auth.requireUser(2),{code:'AUTH_REQUIRED'});
    await auth.login(2,'member','member-test-password');
    await auth.resetPassword(1,member.id,'changed-test-password');
    await assert.rejects(auth.requireUser(2),{code:'AUTH_REQUIRED'});
    await assert.rejects(auth.login(2,'member','member-test-password'),{code:'INVALID_CREDENTIALS'});
    await auth.login(2,'member','changed-test-password');
    assert.equal((await auth.requireUser(2)).id,member.id);
    auth.logout(2);
    await assert.rejects(auth.requireUser(2),{code:'AUTH_REQUIRED'});
    assert.equal((await auth.listUsers(1)).length,3);
  } finally { db.close(); await fs.rm(directory,{recursive:true,force:true}); }
});

test('历史和知识库支持筛选、更新、删除及重启后读取', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-remix-persist-'));
  let db = new LocalSQLiteManager(directory);
  try {
    await db.ensureInitialized();
    const seed = (await db.listRecords())[0];
    const record = {...seed,id:'persist-record',platform:'xiaohongshu' as const,title:'业务验证标题',
      originalTranscript:'人工修订口播',refinementHistory:[{id:'v1',round:1,instruction:'初始生成',timestamp:new Date().toISOString(),scriptSnapshot:seed.rawGeneratedScript}],
      conversationMessages:[{role:'user' as const,content:'原始提示词'},{role:'assistant' as const,content:seed.rawGeneratedScript}]};
    await db.upsertRecord(record);
    await db.upsertKnowledgeDoc({id:'persist-doc',name:'验证.txt',filePath:'',fileType:'txt',sizeBytes:6,uploadedAt:new Date().toISOString(),
      fullContent:'企业正文',contentSnippet:'企业正文',charCount:4,enabled:true});
    await db.toggleKnowledgeDoc('persist-doc',false);
    db.close();
    db = new LocalSQLiteManager(directory);
    await db.ensureInitialized();
    const results = await db.listRecords({platform:'xiaohongshu',search:'业务验证'});
    assert.equal(results.length,1); assert.equal(results[0].originalTranscript,'人工修订口播');
    assert.deepEqual(results[0].conversationMessages,record.conversationMessages);
    assert.equal((await db.listRecords({platform:'douyin',search:'业务验证'})).length,0);
    assert.equal((await db.listRecords({search:"' OR 1=1 --"})).length,0);
    const document = (await db.listKnowledgeDocs()).find((doc) => doc.id === 'persist-doc')!;
    assert.equal(document.fullContent,'企业正文'); assert.equal(document.enabled,false);
    await db.upsertRecord({...results[0],title:'更新后标题'});
    assert.equal((await db.listRecords({search:'更新后标题'})).length,1);
    await db.deleteRecord('persist-record'); await db.deleteKnowledgeDoc('persist-doc');
    assert.equal((await db.listRecords({search:'更新后标题'})).length,0);
    assert.equal((await db.listKnowledgeDocs()).some((doc) => doc.id === 'persist-doc'),false);
  } finally { db.close(); await fs.rm(directory,{recursive:true,force:true}); }
});


test('主动清空历史和知识库后重启不会恢复示例数据', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-remix-empty-'));
  let db = new LocalSQLiteManager(directory);
  try {
    await db.ensureInitialized();
    assert.equal((await db.listRecords()).length, 1);
    assert.equal((await db.listKnowledgeDocs()).length, 0);
    await db.upsertKnowledgeDoc({ id: 'temporary', name: '文档.txt', filePath: '', fileType: 'txt', sizeBytes: 6, uploadedAt: new Date().toISOString(),
      fullContent: '测试资料', contentSnippet: '测试资料', charCount: 4, enabled: true });
    for (const record of await db.listRecords()) await db.deleteRecord(record.id);
    for (const doc of await db.listKnowledgeDocs()) await db.deleteKnowledgeDoc(doc.id);
    assert.equal((await db.listRecords()).length, 0);
    assert.equal((await db.listKnowledgeDocs()).length, 0);
    db.close();
    db = new LocalSQLiteManager(directory);
    await db.ensureInitialized();
    assert.equal((await db.listRecords()).length, 0);
    assert.equal((await db.listKnowledgeDocs()).length, 0);
  } finally { db.close(); await fs.rm(directory, {recursive:true, force:true}); }
});


test('旧库迁移后仍可读取旧历史，原始素材与人工修改稿分别跨重启保留', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'remix-source-history-'));
  let db = new LocalSQLiteManager(directory);
  try {
    const oldRecord = (await db.listRecords())[0];
    db.close();
    // 构造没有新增列的上一版 SQLite 数据库，验证实际迁移而非只测新库。
    const SQL = await require('sql.js')();
    const file = path.join(directory,'video-remix-history.sqlite');
    const legacy = new SQL.Database(await fs.readFile(file));
    legacy.run('ALTER TABLE history_records DROP COLUMN source_content_json');
    await fs.writeFile(file,Buffer.from(legacy.export())); legacy.close();
    db = new LocalSQLiteManager(directory);
    assert.equal((await db.listRecords())[0].id, oldRecord.id);
    assert.equal((await db.listRecords())[0].sourceContent, undefined);
    const sourceContent = {platform:'douyin' as const,extractedUrl:'https://v.douyin.com/demo/',title:'原视频',author:'作者',
      durationSec:18,transcript:'原始口播',publishedText:'原始发布文案',transcriptionStatus:'succeeded' as const,visualSummary:'',suggestedCameraWork:'',
      extractionDetails:{provider:'linkdigest' as const,transcriptSegments:[{t:0,text:'原始口播'}],onScreen:[],images:[{ocr:'第一张',description:'图一'},{ocr:'第三张',description:'图三'}],
        ocrText:['第一张','第三张'],keyPoints:[],warnings:['测试覆盖提示'],credits:3,coverage:{imagesRead:2,imagesTotal:3}}};
    await db.upsertRecord({...oldRecord,id:'source-snapshot',originalTranscript:'人工修改口播',sourceContent});
    db.close(); db = new LocalSQLiteManager(directory);
    const restored = (await db.listRecords()).find(item => item.id === 'source-snapshot')!;
    assert.equal(restored.originalTranscript,'人工修改口播'); assert.deepEqual(restored.sourceContent,sourceContent);
    assert.equal((await db.listRecords()).find(item => item.id === oldRecord.id)?.sourceContent,undefined);
  } finally { db.close(); await fs.rm(directory,{recursive:true,force:true}); }
});
