const fs = require('node:fs');
const path = require('node:path');
const { validateAuthUrl } = require('../dist-electron/services/remoteAuthService.js');
try {
  const url = validateAuthUrl(process.env.REMIX_AUTH_URL || 'https://114.132.186.95');
  fs.writeFileSync(path.join(__dirname, '../dist-electron/auth-config.json'), JSON.stringify({ url }) + '\n', 'utf8');
  fs.copyFileSync(path.join(__dirname, '../dist-electron/services/employeeAuth.js'), path.join(__dirname, '../dist-electron/services/desktopAuth.js'));
  console.log('通用版授权地址已配置：' + url);
} catch {
  console.error('通用版打包需要 REMIX_AUTH_URL，值须为有效的 HTTPS 根地址。');
  process.exit(1);
}
