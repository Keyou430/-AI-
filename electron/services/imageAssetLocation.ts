import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IMAGE_ASSET_DIRECTORY } from './imageTextAssets';
import { userFacingError } from './userFacingError';
export interface ImageAssetLocationInfo {
  directory: string;
  followsData: boolean;
  pendingDirectory?: string;
  migrationError?: string;
  bytes: number;
  count: number;
}
interface Config { independentDirectory?: string; pending?: { directory?: string; followData: boolean }; }
export class ImageAssetLocationService {
  private config: Config = {};
  private error = '';
  private readonly configFile: string;
  constructor(private readonly appDirectory: string) {
    this.configFile = path.join(appDirectory,'image-asset-location.json');
    if (fs.existsSync(this.configFile)) {
      const parsed = JSON.parse(fs.readFileSync(this.configFile,'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed.independentDirectory !== undefined && !path.isAbsolute(parsed.independentDirectory)) ||
          (parsed.pending && (typeof parsed.pending.followData !== 'boolean' || (!parsed.pending.followData && !path.isAbsolute(parsed.pending.directory))))) throw new Error('图文素材地址配置无效。');
      this.config = parsed;
    }
  }
  followsData(): boolean { return !this.config.independentDirectory; }
  root(dataDirectory: string): string { return this.config.independentDirectory || dataDirectory; }
  get(dataDirectory: string): ImageAssetLocationInfo {
    const directory = path.join(this.root(dataDirectory),IMAGE_ASSET_DIRECTORY);
    let bytes = 0; let count = 0; let accessError = '';
    try {
      if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory)) {
        const stat = fs.lstatSync(path.join(directory,name)); if (stat.isFile() && !stat.isSymbolicLink()) { bytes += stat.size; count++; }
      }
      else if (this.config.independentDirectory && !fs.existsSync(this.config.independentDirectory)) accessError = '独立素材目录不可访问，请检查磁盘连接；稿件索引已保留。';
    } catch { accessError = '素材目录不可访问；稿件索引已保留。'; }
    return { directory, followsData: this.followsData(), bytes, count,
      ...(this.config.pending ? { pendingDirectory: path.join(this.config.pending.followData ? dataDirectory : this.config.pending.directory!,IMAGE_ASSET_DIRECTORY) } : {}),
      ...(this.error || accessError ? { migrationError: this.error || accessError } : {}) };
  }
  private save(config: Config) {
    fs.mkdirSync(this.appDirectory,{ recursive: true });
    const temporary = this.configFile + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary,JSON.stringify(config),'utf8'); fs.renameSync(temporary,this.configFile); this.config = config; this.error = ''; }
    finally { fs.rmSync(temporary,{force:true}); }
  }
  schedule(directory: string | undefined, dataDirectory: string): ImageAssetLocationInfo {
    const target = directory === undefined ? dataDirectory : fs.realpathSync(directory);
    if (!path.isAbsolute(target) || !fs.statSync(target).isDirectory()) throw new Error('请选择有效的素材文件夹。');
    fs.accessSync(target,fs.constants.W_OK);
    if (path.resolve(target) !== path.resolve(this.root(dataDirectory))) this.assertTarget(target,dataDirectory,directory === undefined);
    this.save({ ...this.config, pending: { directory: directory === undefined ? undefined : target, followData: directory === undefined } });
    return this.get(dataDirectory);
  }
  private assertTarget(target: string, dataDirectory: string, returningToData = false) {
    if (!returningToData && fs.existsSync(path.join(target,IMAGE_ASSET_DIRECTORY))) throw new Error('目标已有图文素材目录，请选择其他目录以免覆盖。');
    const source = path.resolve(this.root(dataDirectory),IMAGE_ASSET_DIRECTORY);
    const relative = path.relative(source,path.resolve(target));
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('不能将素材目录或其子目录作为迁移目标。');
  }
  activatePending(dataDirectory: string): void {
    const pending = this.config.pending; if (!pending) return;
    const target = pending.followData ? dataDirectory : pending.directory!;
    const currentRoot = this.root(dataDirectory);
    const copied: string[] = []; let createdDirectory: string | undefined;
    try {
      if (path.resolve(target) !== path.resolve(currentRoot)) {
        this.assertTarget(target,dataDirectory,pending.followData); fs.accessSync(target,fs.constants.W_OK);
        const source = path.join(currentRoot,IMAGE_ASSET_DIRECTORY);
        const destination = path.join(target,IMAGE_ASSET_DIRECTORY);
        if (!fs.existsSync(destination)) { fs.mkdirSync(destination); createdDirectory = destination; }
        if (fs.existsSync(source)) for (const name of fs.readdirSync(source)) {
          const from = path.join(source,name); const stat = fs.lstatSync(from);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('素材目录包含非普通文件，已停止迁移。');
          const to = path.join(destination,name);
          if (fs.existsSync(to)) {
            const destinationStat = fs.lstatSync(to);
            if (!destinationStat.isFile() || destinationStat.isSymbolicLink() || !fs.readFileSync(from).equals(fs.readFileSync(to))) throw new Error('返回的数据素材目录包含同名但内容不同的图片，已停止迁移。');
          } else { fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL); copied.push(to); }
        }
      }
      this.save(pending.followData ? {} : { independentDirectory: target });
    } catch (error) {
      for (const file of copied) fs.rmSync(file,{force:true});
      if (createdDirectory) fs.rmdirSync(createdDirectory);
      this.error = userFacingError(error,'图文素材迁移失败，仍使用原目录。');
    }
  }
}
