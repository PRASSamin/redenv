import { scrypt, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: import("crypto").ScryptOptions
) => Promise<Buffer>;

// All constants are for AES-256-GCM
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // GCM standard
const SALT_LENGTH = 64;
const KEY_LENGTH = 32; // 256 bits
const AUTH_TAG_LENGTH = 16;

// Scrypt parameters - OWASP recommendations for interactive use
const SCRYPT_OPTIONS = {
  N: 16384, // CPU/memory cost factor
  r: 8, // Block size
  p: 1, // Parallelization factor
};

/**
 * Derives a key from a password and salt using scrypt.
 */
export async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  const key = (await scryptAsync(
    password,
    salt,
    KEY_LENGTH,
    SCRYPT_OPTIONS
  )) as Buffer;
  return key;
}

/**
 * Generates a new random salt.
 */
export function generateSalt(): Buffer {
  return randomBytes(SALT_LENGTH);
}

/**
 * Generates a new random 256-bit key.
 */
export function generateRandomKey(): Buffer {
  return randomBytes(KEY_LENGTH);
}

/**
 * Encrypts data using AES-256-GCM.
 * @returns A string containing the iv, auth tag, and encrypted data, formatted for storage.
 */
export function encrypt(data: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine iv, authTag, and encrypted data into a single string for storage
  return `${iv.toString("hex")}:${authTag.toString(
    "hex"
  )}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts data that was encrypted with the encrypt function.
 */
export function decrypt(encryptedString: string, key: Buffer): string {
  try {
    const parts = encryptedString.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted string format.");
    }
    const [ivHex, authTagHex, encryptedHex] = parts;

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    // If decryption fails (e.g., wrong password/key), it will throw an error.
    // We catch it to provide a more user-friendly message.
    throw new Error(
      "Decryption failed. This likely means you entered the wrong password."
    );
  }
}
