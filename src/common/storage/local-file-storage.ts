import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'fs';
import { mkdir, rm, stat, writeFile } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'path';
import { Readable } from 'stream';
import { FileStorage } from './file-storage';

/**
 * Stores files on the server's disk under UPLOAD_DIR (default "./uploads").
 * On a real server point UPLOAD_DIR at a persistent volume (outside the deploy folder, so
 * redeploys do not wipe it). Files are never served statically; they only leave through
 * the API after an access check.
 */
@Injectable()
export class LocalFileStorage extends FileStorage {
  private readonly logger = new Logger(LocalFileStorage.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    super();
    this.root = resolve(config.get<string>('UPLOAD_DIR') ?? './uploads');
    this.logger.log(`Uploads directory: ${this.root}`);
  }

  async save(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async read(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    try {
      await stat(path);
    } catch {
      throw new NotFoundException('The file is no longer available.');
    }
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** Resolves a key inside the root and refuses anything that escapes it ("../"). */
  private pathFor(key: string): string {
    const path = resolve(this.root, key);
    const rel = relative(this.root, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Invalid storage key');
    }
    return path;
  }
}
