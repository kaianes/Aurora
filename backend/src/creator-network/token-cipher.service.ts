import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface EncryptedToken {
  ciphertext: string;
  nonce: string;
  keyVersion: number;
}

// ADR-0049: application-level envelope encryption for OAuth tokens at rest
// (NFR-15). AES-256-GCM with a per-record nonce; the master key is supplied
// via externalized configuration (TOKEN_ENCRYPTION_KEY), never checked into
// source, the same mechanism JWT_SECRET already uses. token_key_version is
// stored per record specifically so a future master-key rotation can
// re-encrypt records lazily rather than requiring a synchronous, all-at-once
// migration -- this pilot ships exactly one key version.
@Injectable()
export class TokenCipherService {
  private static readonly CURRENT_KEY_VERSION = 1;
  private static readonly AUTH_TAG_LENGTH = 16;

  constructor(private configService: ConfigService) {}

  encrypt(plaintext: string): EncryptedToken {
    const key = this.getKey(TokenCipherService.CURRENT_KEY_VERSION);
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: Buffer.concat([encrypted, authTag]).toString('base64'),
      nonce: nonce.toString('base64'),
      keyVersion: TokenCipherService.CURRENT_KEY_VERSION,
    };
  }

  decrypt(input: EncryptedToken): string {
    const key = this.getKey(input.keyVersion);
    const nonce = Buffer.from(input.nonce, 'base64');
    const data = Buffer.from(input.ciphertext, 'base64');
    const authTag = data.subarray(data.length - TokenCipherService.AUTH_TAG_LENGTH);
    const encrypted = data.subarray(0, data.length - TokenCipherService.AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  // keyVersion is accepted (not just the current one) so a future real
  // key-management upgrade can hold more than one key concurrently without
  // a schema change -- this pilot only ever issues version 1.
  private getKey(_keyVersion: number): Buffer {
    const raw =
      this.configService.get<string>('TOKEN_ENCRYPTION_KEY') ||
      'pilot-only-insecure-default-token-key';
    return crypto.createHash('sha256').update(raw).digest();
  }
}
