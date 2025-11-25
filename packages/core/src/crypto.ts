/**
 * Universal crypto functions using the Web Crypto API.
 * Works in Node.js (v16+), Deno, Bun, and browsers.
 */

// Access the universal Web Crypto API.
const crypto = globalThis.crypto;

// --- Configuration ---
const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // Recommended for AES-GCM
const KEY_LENGTH = 256;
const HASH_ALGORITHM = "SHA-256";
const PBKDF2_ITERATIONS = 310000; // OWASP recommendation for PBKDF2-HMAC-SHA256
const SALT_LENGTH = 16; // Recommended for PBKDF2

// --- Helper Functions ---
export const bufferToHex = (buffer: ArrayBuffer): string => {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const hexToBuffer = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
};

// --- Core Functions ---

/**
 * Generates a random byte array of the specified length.
 */
export function randomBytes(length: number = 16): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Generates a new random salt.
 */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_LENGTH);
}

/**
 * Generates a new random 256-bit CryptoKey for encryption and decryption.
 */
export async function generateRandomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable
    ["encrypt", "decrypt"]
  );
}

/**
 * Exports a CryptoKey to a raw hex string for storage.
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return bufferToHex(rawKey);
}

/**
 * Imports a raw hex string back into a CryptoKey.
 */
export async function importKey(hex: string): Promise<CryptoKey> {
  const buffer = hexToBuffer(hex);
  return crypto.subtle.importKey(
    "raw",
    buffer as any,
    { name: ALGORITHM },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Derives an encryption key from a password and salt using PBKDF2.
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      //@ts-expect-error: unknown
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALGORITHM,
    },
    baseKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
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

  return `${bufferToHex(iv.buffer)}.${bufferToHex(ciphertext)}`;
}

/**
 * Decrypts data that was encrypted with the `encrypt` function.
 */
export async function decrypt(
  encryptedString: string,
  key: CryptoKey
): Promise<string> {
  if (!encryptedString) {
    throw new Error("Encrypted string cannot be empty.");
  }

  const parts = encryptedString.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid encrypted string format.");
  }

  try {
    const iv = hexToBuffer(parts[0]);
    const ciphertext = hexToBuffer(parts[1]);

    const decryptedData = await crypto.subtle.decrypt(
      {
        name: ALGORITHM,
        //@ts-expect-error: unknown
        iv: iv,
      },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decryptedData);
  } catch {
    throw new Error(
      "Decryption failed. This likely means an incorrect password was used or the data is corrupted."
    );
  }
}
