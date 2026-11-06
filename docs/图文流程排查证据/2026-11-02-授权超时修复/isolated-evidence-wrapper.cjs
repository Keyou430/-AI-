const fs=require('node:fs'); const path=require('node:path'); const Module=require('node:module');
const root="D:/骏冠/新媒体/video-remix-ai-assistant-full";
const file=path.join(root,'scripts/imageTextRegression.cjs');
let source=fs.readFileSync(file,'utf8');
source=source.replace("let source = fs.readFileSync(sourcePath,'utf8');", "let source = fs.readFileSync(sourcePath,'utf8').replaceAll('2026-11-02-删除跳转-三模块布局','2026-11-02-授权超时修复-三模块布局');");
const from=':undefined,providerClass:LocalProviderService';
if(!source.includes(from))throw new Error('evidence redirect anchor missing');
source=source.replace(from,':path.join(__dirname,"..","docs","图文流程排查证据","2026-11-02-授权超时修复-回归"),providerClass:LocalProviderService');
const runtime=new Module(file,module); runtime.filename=file;runtime.paths=Module._nodeModulePaths(path.dirname(file));runtime._compile(source,file);
