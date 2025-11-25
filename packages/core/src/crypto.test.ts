import { describe, it, expect } from 'vitest';
import {
  deriveKey,
  generateSalt,
  encrypt,
  decrypt,
  generateRandomKey,
  exportKey,
} from './crypto';

describe('Web Crypto Utilities', () => {
  it('should encrypt and then correctly decrypt data to its original form', async () => {
    const data = 'my secret data 🤫';
    const key = await generateRandomKey();
    const encrypted = await encrypt(data, key);
    const decrypted = await decrypt(encrypted, key);
    
    expect(decrypted).toBe(data);
    expect(encrypted).not.toBe(data);
  });

  it('should fail to decrypt data with the wrong key', async () => {
    const data = 'my secret data';
    const correctKey = await generateRandomKey();
    const wrongKey = await generateRandomKey();
    const encrypted = await encrypt(data, correctKey);

    await expect(decrypt(encrypted, wrongKey)).rejects.toThrow(/Decryption failed/);
  });

  it('should derive a key that can be used for encryption', async () => {
    const password = 'my-super-secret-password';
    const salt = generateSalt();
    const derivedKey = await deriveKey(password, salt);
    
    // The best test is to see if it actually works for a round-trip
    const data = 'test';
    const encrypted = await encrypt(data, derivedKey);
    const decrypted = await decrypt(encrypted, derivedKey);
    expect(decrypted).toBe(data);
  });

  it('should produce different keys for the same password with different salts', async () => {
    const password = 'my-super-secret-password';
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    
    const derivedKey1 = await deriveKey(password, salt1);
    const derivedKey2 = await deriveKey(password, salt2);

    const exportedKey1 = await exportKey(derivedKey1);
    const exportedKey2 = await exportKey(derivedKey2);

    expect(exportedKey1).not.toEqual(exportedKey2);
  });

  it('should throw an error if the encrypted string format is invalid', async () => {
    const key = await generateRandomKey();
    const invalidString = 'this-is-not-valid';
    
    await expect(decrypt(invalidString, key)).rejects.toThrow(/Invalid encrypted string format/);
  });
});