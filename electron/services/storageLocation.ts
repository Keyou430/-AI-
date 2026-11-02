import { userFacingError } from './userFacingError';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IMAGE_ASSET_DIRECTORY } from './imageTextAssets';

export interface StorageLocation {
  directory: string;
  pendingDirectory?: string;
  migrationError?: string;
}

const databaseName = 'video-remix-history.sqlite';

/** 迁移业务数据库及图文图片；设备密钥、日志和界面偏好保留在应用目录。 */
export class StorageLocationService {
  private readonly configPath: string;
  private location: StorageLocation;
  private migrationError = '';

  constructor(private readonly defaultDirectory: string, private readonly migrateImages = true) {
    this.configPath = path.join(defaultDirectory, 'storage-location.json');
    this.location = { directory: defaultDirectory };
    if (fs.existsSync(this.configPath)) {
      const config: unknown = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      if (
        !config ||
        typeof config !== 'object' ||
        !('directory' in config) ||
        typeof config.directory !== 'string' ||
        !path.isAbsolute(config.directory) ||
        ('pendingDirectory' in config &&
          (typeof config.pendingDirectory !== 'string' ||
            !path.isAbsolute(config.pendingDirectory)))
      ) {
        throw new Error('存储地址配置无效，请检查本设备的存储配置。');
      }
      this.location = {
        directory: config.directory,
        ...('pendingDirectory' in config
          ? { pendingDirectory: config.pendingDirectory as string }
          : {}),
      };
    }
  }

  get(): StorageLocation {
    return {
      ...this.location,
      ...(this.migrationError ? { migrationError: this.migrationError } : {}),
    };
  }

  private save(location: StorageLocation): void {
    fs.mkdirSync(this.defaultDirectory, { recursive: true });
    const temporaryPath = this.configPath + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(location) + '\n', {
        encoding: 'utf8',
        flag: 'wx',
      });
      fs.renameSync(temporaryPath, this.configPath);
      this.location = location;
      this.migrationError = '';
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }

  schedule(directory: string): StorageLocation {
    if (!path.isAbsolute(directory)) throw new Error('请选择有效的绝对目录。');
    const target = fs.realpathSync(directory);
    if (!fs.statSync(target).isDirectory()) throw new Error('请选择文件夹作为存储地址。');
    if (target === fs.realpathSync(this.location.directory)) {
      this.save({ directory: this.location.directory });
      return this.get();
    }
    this.assertDestinationEmpty(target);
    fs.accessSync(target, fs.constants.W_OK);
    this.save({ directory: this.location.directory, pendingDirectory: target });
    return this.get();
  }

  private assertDestinationEmpty(directory: string): void {
    if (this.migrateImages && fs.existsSync(path.join(directory, IMAGE_ASSET_DIRECTORY))) {
      throw new Error('所选目录已有图文图片，请选择其他目录，避免覆盖已有素材。');
    }
    const sourceAssets = path.resolve(this.location.directory, IMAGE_ASSET_DIRECTORY);
    const relative = path.relative(sourceAssets, path.resolve(directory));
    if (this.migrateImages && (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)))) {
      throw new Error('不能将图片目录或其子目录作为迁移目标。');
    }
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (fs.existsSync(path.join(directory, databaseName + suffix))) {
        throw new Error('所选目录已有应用数据库，请选择其他目录，避免覆盖已有记录。');
      }
    }
  }

  /** 在数据库连接建立前执行；源数据保留，失败时回滚本次复制并保持原配置。 */
  activatePending(): string {
    const target = this.location.pendingDirectory;
    if (!target) return this.location.directory;
    const copied: string[] = [];
    let copiedAssetsDirectory: string | undefined;
    try {
      this.assertDestinationEmpty(target);
      fs.accessSync(target, fs.constants.W_OK);
      const source = path.join(this.location.directory, databaseName);
      if (!fs.existsSync(source)) throw new Error('原存储目录的数据库不存在，已停止迁移。');
      // WAL / 回滚日志可能包含上次异常退出前的事务；不复制可重建的共享内存文件。
      for (const suffix of ['', '-wal', '-journal']) {
        if (!fs.existsSync(source + suffix)) continue;
        const destination = path.join(target, databaseName + suffix);
        fs.copyFileSync(source + suffix, destination, fs.constants.COPYFILE_EXCL);
        copied.push(destination);
      }
      const sourceAssets = path.join(this.location.directory, IMAGE_ASSET_DIRECTORY);
      if (this.migrateImages && fs.existsSync(sourceAssets)) {
        const destinationAssets = path.join(target, IMAGE_ASSET_DIRECTORY);
        fs.mkdirSync(destinationAssets);
        copiedAssetsDirectory = destinationAssets;
        for (const name of fs.readdirSync(sourceAssets)) {
          const file = path.join(sourceAssets, name);
          const stat = fs.lstatSync(file);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('图片目录存在非普通文件，已停止迁移。');
          const destination = path.join(destinationAssets, name);
          fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
          copied.push(destination);
        }
      }
      this.save({ directory: target });
      return target;
    } catch (error) {
      for (const file of copied) fs.rmSync(file, { force: true });
      if (copiedAssetsDirectory) fs.rmdirSync(copiedAssetsDirectory);
      this.migrationError = userFacingError(error, '目标目录无法写入，请重新选择存储地址。');
      return this.location.directory;
    }
  }
}
