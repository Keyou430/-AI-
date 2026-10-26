import fs from 'node:fs';
import path from 'node:path';
import { createAuthServer } from './authServer';

async function start() {
  const port = Number(process.env.AUTH_PORT || '3080');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('AUTH_PORT 无效');
  const passwordFile = process.env.AUTH_ADMIN_PASSWORD_FILE;
  const server = await createAuthServer({
    dataDirectory: path.resolve(process.env.AUTH_DATA_DIR || './auth-data'),
    adminPassword: passwordFile ? fs.readFileSync(passwordFile, 'utf8').replace(/\r?\n$/, '') : undefined,
    adminName: process.env.AUTH_ADMIN_NAME,
    trustLoopbackProxy: true,
  });
  server.listen(port, '127.0.0.1', () => console.log('授权服务已启动，监听本机端口 ' + port));
  server.on('error', () => { console.error('授权服务监听失败'); process.exit(1); });
  const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
start().catch(() => { console.error('授权服务启动失败，请检查数据目录及管理员密码文件配置'); process.exit(1); });
