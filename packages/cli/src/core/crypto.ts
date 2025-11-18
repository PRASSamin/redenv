import { webcrypto } from 'crypto';

// Re-export the specific CryptoKey type to ensure consistency across the app
export type CryptoKey = webcrypto.CryptoKey;
const crypto = webcrypto;

// --- Configuration ---
const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12; // Recommended for AES-GCM
const KEY_LENGTH = 256;
const HASH_ALGORITHM = 'SHA-256';
const PBKDF2_ITERATIONS = 310000; // OWASP recommendation for PBKDF2-HMAC-SHA256
const SALT_LENGTH = 16; // Recommended for PBKDF2

// --- Helper Functions ---
const bufferToHex = (buffer: ArrayBuffer | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Buffer.from(bytes).toString('hex');
};
const hexToBuffer = (hex: string): Uint8Array =>
  Buffer.from(hex, 'hex');

// --- Core Functions ---

/**
 * Generates a new random salt.
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Generates a new random 256-bit CryptoKey.
 */
export async function generateRandomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Exports a CryptoKey to a raw hex string for storage.
 */
export async function exportKey(key: CryptoKey): Promise<string> {
    const rawKey = await crypto.subtle.exportKey('raw', key);
    return bufferToHex(rawKey);
}

/**
 * Imports a raw hex string back into a CryptoKey.
 */
export async function importKey(hex: string): Promise<CryptoKey> {
    const buffer = hexToBuffer(hex);
    return crypto.subtle.importKey(
        'raw',
        buffer,
        { name: ALGORITHM },
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * Derives a key from a password and salt using PBKDF2.
 */
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALGORITHM,
    },
    baseKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts data using AES-256-GCM.
 * @returns A string containing the iv and the ciphertext, separated by a dot.
 */
export async function encrypt(data: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encodedData = new TextEncoder().encode(data);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv },
    key,
    encodedData
  );

  return `${bufferToHex(iv)}.${bufferToHex(ciphertext)}`;
}

/**
 * Decrypts data that was encrypted with the encrypt function.
 */
export async function decrypt(encryptedString: string, key: CryptoKey): Promise<string> {
  const parts = encryptedString.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted string format.');
  }
  
  try {
    const iv = hexToBuffer(parts[0]);
    const ciphertext = hexToBuffer(parts[1]);

    const decryptedData = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decryptedData);
  } catch (error) {
    throw new Error(
      'Decryption failed. This likely means an incorrect password was used or the data is corrupted.'
    );
  }
}