const fs = require('node:fs');
const path = require('node:path');
const { validateAuthUrl } = require('../dist-electron/services/remoteAuthService.js');
try {
  const url = validateAuthUrl(process.env.REMIX_AUTH_URL || 'https://114.132.186.95');
  fs.writeFileSync(path.join(__dirname, '../dist-electron/auth-config.json'), JSON.stringify({ url, binding: 'installation' }) + '\n', 'utf8');
  fs.copyFileSync(path.join(__dirname, '../dist-electron/services/employeeAuth.js'), path.join(__dirname, '../dist-electron/services/desktopAuth.js'));
  console.log('通用版已启用首次安装绑定；旧版升级兼容地址：' + url);
} catch {
  console.error('通用版打包需要 REMIX_AUTH_URL，值须为有效的 HTTPS 根地址。');
  process.exit(1);
}
