const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
const run = promisify(execFile);

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-auth-installer-'));
  const device = path.join(directory, 'device');
  const installer = path.join(directory, 'auth-binding-fixture.exe');
  const uninstaller = path.join(directory, 'uninstall-fixture.exe');
  const source = [
    'Unicode true',
    'RequestExecutionLevel user',
    'Name "Auth Binding Verification"',
    'OutFile "' + installer + '"',
    '!define PROJECT_DIR "' + path.resolve('.') + '"',
    '!define APP_PACKAGE_NAME "auth-binding-verification"',
    '!define AUTH_DATA_DIRECTORY "' + device + '"',
    '!define isUpdated \'' + '$fixtureUpdated == "1"' + '\'',
    '!include "FileFunc.nsh"',
    'Var hasPerUserInstallation',
    'Var hasPerMachineInstallation',
    'Var fixtureUpdated',
    '!include "' + path.resolve('installer/authServerBinding.nsh') + '"',
    '!insertmacro customPageAfterChangeDir',
    '!insertmacro MUI_PAGE_INSTFILES',
    '!insertmacro MUI_LANGUAGE "SimpChinese"',
    'Function .onInit',
    '  StrCpy $hasPerUserInstallation "0"',
    '  StrCpy $hasPerMachineInstallation "0"',
    '  ${GetParameters} $0',
    '  ClearErrors',
    '  ${GetOptions} $0 "/UPGRADE" $1',
    '  ${IfNot} ${Errors}',
    '    StrCpy $hasPerUserInstallation "1"',
    '  ${EndIf}',
    '  !insertmacro customInit',
    'FunctionEnd',
    'Section "Install"',
    '  !insertmacro customInstall',
    '  WriteUninstaller "' + uninstaller + '"',
    'SectionEnd',
    'Function un.onInit',
    '  StrCpy $fixtureUpdated "0"',
    '  ${GetParameters} $0',
    '  ClearErrors',
    '  ${GetOptions} $0 "/UPDATED" $1',
    '  ${IfNot} ${Errors}',
    '    StrCpy $fixtureUpdated "1"',
    '  ${EndIf}',
    'FunctionEnd',
    'Section "Uninstall"',
    '  !insertmacro customUnInstall',
    'SectionEnd',
  ].join('\r\n');
  try {
    const input = path.join(directory, 'fixture.nsi');
    await fs.writeFile(input, '\uFEFF' + source, 'utf8');
    const compiler = await getMakeNsisPath();
    await run(compiler.path, ['/V2', '/WX', input], { timeout: 60000, env: { ...process.env, ...compiler.env } });
    await assert.rejects(run(installer, ['/S'], { timeout: 15000 }), error => error.code === 1);
    await run(installer, ['/S', '/UPGRADE'], { timeout: 20000 });
    const bindingFile = path.join(device, 'auth-server-binding.json');
    const initial = await fs.readFile(bindingFile, 'utf8');
    assert.equal(JSON.parse(initial).url, JSON.parse(await fs.readFile('dist-electron/auth-config.json', 'utf8')).url);
    const apiFile = path.join(device, 'providers.encrypted');
    await fs.writeFile(apiFile, 'ISOLATED_API_FIXTURE');
    await fs.writeFile(path.join(device, 'business.keep'), 'ISOLATED_BUSINESS_FIXTURE');
    await run(installer, ['/S'], { timeout: 20000 });
    assert.equal(await fs.readFile(bindingFile, 'utf8'), initial);
    assert.equal(await fs.readFile(apiFile, 'utf8'), 'ISOLATED_API_FIXTURE');
    await run(uninstaller, ['/S', '/UPDATED', '_?=' + directory], { timeout: 20000 });
    assert.equal(await fs.readFile(bindingFile, 'utf8'), initial);
    assert.equal(await fs.readFile(apiFile, 'utf8'), 'ISOLATED_API_FIXTURE');
    await run(uninstaller, ['/S', '_?=' + directory], { timeout: 20000 });
    await assert.rejects(fs.access(bindingFile), { code: 'ENOENT' });
    await assert.rejects(fs.access(apiFile), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(device, 'business.keep'), 'utf8'), 'ISOLATED_BUSINESS_FIXTURE');
    console.log(JSON.stringify({ success: true, cases: 6, directory, installer, uninstaller, device }));
  } finally {
    if (!process.argv.includes('--keep')) await fs.rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
