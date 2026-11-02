import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const IMAGE_ASSET_DIRECTORY = 'image-text-assets';
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export function imageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' {
  const b = Buffer.from(bytes);
  if (b.length > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 20 MB。');
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('图片格式无效，请使用 PNG、JPEG 或 WebP。');
}
export class ImageTextAssets {
  readonly directory: string;
  constructor(directory: string) { this.directory = path.join(directory, IMAGE_ASSET_DIRECTORY); }
  private file(id: string): string {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('图片标识无效。');
    return path.join(this.directory, id);
  }
  async save(bytes: Uint8Array): Promise<string> {
    imageMime(bytes);
    await fs.mkdir(this.directory, { recursive: true });
    const id = randomUUID();
    await fs.writeFile(this.file(id), bytes, { flag: 'wx' });
    return id;
  }
  async remove(id: string): Promise<void> { await fs.unlink(this.file(id)); }
  async read(id: string): Promise<Buffer> {
    const file = this.file(id);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_IMAGE_BYTES) throw new Error('本地图片文件无效。');
    const bytes = await fs.readFile(file); imageMime(bytes); return bytes;
  }
  async dataURL(id: string): Promise<string> {
    const bytes = await this.read(id);
    return 'data:' + imageMime(bytes) + ';base64,' + bytes.toString('base64');
  }
}
