const fs = require('node:fs');
const path = require('node:path');

fs.writeFileSync(path.join(__dirname, '../dist-electron/auth-config.json'), JSON.stringify({ binding: 'installation' }) + '\n', 'utf8');
fs.copyFileSync(path.join(__dirname, '../dist-electron/services/employeeAuth.js'), path.join(__dirname, '../dist-electron/services/desktopAuth.js'));
console.log('通用版已启用安装绑定，安装包不包含授权服务器地址。');
