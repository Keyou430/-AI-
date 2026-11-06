const { spawn } = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path');
const root = "D:/骏冠/新媒体/video-remix-ai-assistant-full"; const target = process.argv[2]; const log = process.argv[3];
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const stream = fs.createWriteStream(log); const child = spawn(path.join(root,'node_modules/electron/dist/electron.exe'), [target, root], { cwd: root, windowsHide: true, env, stdio: ['ignore','pipe','pipe'] });
child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
const timer = setTimeout(() => { child.kill(); console.error('隔离桌面验收超过 185 秒'); }, 185000);
child.on('error', error => { clearTimeout(timer); stream.end(String(error)); process.exitCode = 1; });
child.on('close', code => { clearTimeout(timer); stream.end(); console.log('Electron verification exit: ' + code); process.exitCode = code ?? 1; });
