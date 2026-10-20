import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

/** AES-256-GCM encryption for message text at rest. Stored as `enc:v1:iv:tag:ciphertext` (base64). */
@Injectable()
export class MessageCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get<string>('MESSAGE_ENCRYPTION_KEY');
    if (!secret) throw new Error('MESSAGE_ENCRYPTION_KEY is not set.');
    this.key = createHash('sha256').update(secret).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
  }

  /** Legacy plaintext (no prefix) is returned unchanged. */
  decrypt(stored: string): string {
    if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored;
    const [iv, tag, data] = stored.slice(PREFIX.length).split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}
