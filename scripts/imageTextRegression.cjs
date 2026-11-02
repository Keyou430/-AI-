// 运行前先执行 npm run build；供应商与用户数据全部隔离。
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const sourcePath = path.join(__dirname,'desktopSmoke.cjs');
let source = fs.readFileSync(sourcePath,'utf8');
const marker = '        assert.equal((await imageHistory()).length,1);\n      } finally {';
if (!source.includes(marker)) throw new Error('桌面验收插入位置已变化，请重新核对脚本。');
source = source.replace(marker, '        assert.equal((await imageHistory()).length,1);\n' +
  '        await require(path.join(__dirname,"imageTextRegressionScenarios.cjs"))({window,call,waitFor,clickText,setLabel,imageHistory,baseline:beforeDelete,dataDirectory,referenceFile,applicationPath,evidenceDirectory:applicationPath.endsWith(".asar")?path.join(__dirname,"..","release","image-text-regression-"+require(path.join(applicationPath,"package.json")).version):undefined,providerClass:LocalProviderService,databaseClass:LocalSQLiteManager,baseURL,imageCalls:()=>imageCalls});\n      } finally {');
source = source.replace('}, 90000);','}, 180000);');
source = source.replace('  window.show = () => {};','  window.show = () => {};\n  window.webContents.setBackgroundThrottling(false);');
const runtime = new Module(sourcePath,module);
runtime.filename = sourcePath;
runtime.paths = Module._nodeModulePaths(__dirname);
runtime._compile(source,sourcePath);
