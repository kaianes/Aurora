import { describe, it, expect, vi } from 'vitest';
import { TokenCipherService } from './token-cipher.service';

describe('TokenCipherService - ADR-0049', () => {
  const configService = { get: vi.fn().mockReturnValue('test-key-material') };
  const service = new TokenCipherService(configService as any);

  it('round-trips a token through encrypt then decrypt', () => {
    const plaintext = 'a-very-real-oauth-access-token';
    const encrypted = service.encrypt(plaintext);

    expect(encrypted.ciphertext).not.toContain(plaintext);
    expect(encrypted.keyVersion).toBe(1);

    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces a different nonce and ciphertext for two separate calls with the same plaintext', () => {
    const first = service.encrypt('same-token');
    const second = service.encrypt('same-token');

    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('fails to decrypt with a tampered ciphertext (authenticity check)', () => {
    const encrypted = service.encrypt('a-token');
    const tampered = { ...encrypted, ciphertext: Buffer.from('garbage-data-of-wrong-shape').toString('base64') };

    expect(() => service.decrypt(tampered)).toThrow();
  });
});
