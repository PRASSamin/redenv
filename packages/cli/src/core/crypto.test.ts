import { describe, it, expect } from 'vitest';
import {
  deriveKey,
  generateSalt,
  encrypt,
  decrypt,
  generateRandomKey,
} from './crypto';

describe('Crypto Utilities', () => {
  it('should encrypt and then correctly decrypt data to its original form', () => {
    const data = 'my secret data';
    const key = generateRandomKey();
    const encrypted = encrypt(data, key);
    const decrypted = decrypt(encrypted, key);
    
    expect(decrypted).toBe(data);
    expect(encrypted).not.toBe(data);
  });

  it('should fail to decrypt data with the wrong key', () => {
    const data = 'my secret data';
    const correctKey = generateRandomKey();
    const wrongKey = generateRandomKey();
    const encrypted = encrypt(data, correctKey);

    // Expecting the decrypt function to throw a specific error for crypto failures
    expect(() => decrypt(encrypted, wrongKey)).toThrow(
      /Decryption failed/
    );
  });

  it('should derive a key of the correct length (32 bytes for AES-256)', async () => {
    const password = 'my-super-secret-password';
    const salt = generateSalt();
    const derivedKey = await deriveKey(password, salt);
    
    expect(derivedKey.length).toBe(32);
  });

  it('should produce different keys for the same password with different salts', async () => {
    const password = 'my-super-secret-password';
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    
    const derivedKey1 = await deriveKey(password, salt1);
    const derivedKey2 = await deriveKey(password, salt2);

    expect(derivedKey1).not.toEqual(derivedKey2);
  });

  it('should throw an error if the encrypted string format is invalid', () => {
    const key = generateRandomKey();
    const invalidString1 = 'this-is-not-valid';
    const invalidString2 = 'this:is:not:valid:at:all';
    
    expect(() => decrypt(invalidString1, key)).toThrow(/Invalid encrypted string format/);
    expect(() => decrypt(invalidString2, key)).toThrow(/Invalid encrypted string format/);
  });
});
