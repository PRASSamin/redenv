import { describe, it, expect } from "vitest";
import {
  deriveKey,
  generateSalt,
  encrypt,
  decrypt,
  generateRandomKey,
  exportKey,
  bufferToHex,
  hexToBuffer,
  importKey,
  randomBytes,
} from "./crypto";

// --- Constants from crypto.ts for verification ---
const SALT_LENGTH = 16;

describe("Web Crypto Utilities", () => {
  describe("Helper Functions", () => {
    it("should correctly convert a buffer to a hex string", () => {
      const buffer = new Uint8Array([1, 10, 100, 255]);
      expect(bufferToHex(buffer)).toBe("010a64ff");
    });

    it("should correctly convert a hex string to a buffer", () => {
      const hex = "010a64ff";
      const buffer = new Uint8Array([1, 10, 100, 255]);
      expect(hexToBuffer(hex)).toEqual(buffer);
    });

    it("should perform a perfect round-trip from buffer -> hex -> buffer", () => {
      const originalBuffer = crypto.getRandomValues(new Uint8Array(32));
      const hex = bufferToHex(originalBuffer);
      const finalBuffer = hexToBuffer(hex);
      expect(finalBuffer).toEqual(originalBuffer);
    });
  });

  describe("Core Encryption/Decryption", () => {
    it("should encrypt and then correctly decrypt data to its original form", async () => {
      const data = "my secret data 🤫";
      const key = await generateRandomKey();
      const encrypted = await encrypt(data, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(data);
      expect(encrypted).not.toBe(data);
    });

    it("should fail to decrypt data with the wrong key", async () => {
      const data = "my secret data";
      const correctKey = await generateRandomKey();
      const wrongKey = await generateRandomKey();
      const encrypted = await encrypt(data, correctKey);

      await expect(decrypt(encrypted, wrongKey)).rejects.toThrow(
        /Decryption failed/
      );
    });

    it("should fail to decrypt tampered ciphertext", async () => {
      const data = "some important data";
      const key = await generateRandomKey();
      const encrypted = await encrypt(data, key);

      const [iv, ciphertext] = encrypted.split(".");
      const tamperedCiphertext = "00" + ciphertext.slice(2); // Change first byte
      const tamperedEncryptedString = `${iv}.${tamperedCiphertext}`;

      await expect(decrypt(tamperedEncryptedString, key)).rejects.toThrow(
        /Decryption failed/
      );
    });

    it("should throw an error if the encrypted string format is invalid", async () => {
      const key = await generateRandomKey();
      await expect(decrypt("this-is-not-valid", key)).rejects.toThrow(
        /Invalid encrypted string format/
      );
      await expect(decrypt("abc.123.xyz", key)).rejects.toThrow(
        /Invalid encrypted string format/
      );
    });

    it("should throw an error if the encrypted string is empty", async () => {
      const key = await generateRandomKey();
      await expect(decrypt("", key)).rejects.toThrow(
        /Encrypted string cannot be empty/
      );
    });
  });

  describe("Key Management", () => {
    it("should successfully round-trip a key through export and import", async () => {
      const originalKey = await generateRandomKey();
      const exported = await exportKey(originalKey);
      const importedKey = await importKey(exported);

      // Verify the imported key works
      const data = "test round trip";
      const encrypted = await encrypt(data, importedKey);
      const decrypted = await decrypt(encrypted, originalKey);
      expect(decrypted).toBe(data);
    });

    it("should derive a key that can be used for encryption", async () => {
      const password = "my-super-secret-password";
      const salt = generateSalt();
      const derivedKey = await deriveKey(password, salt);

      const data = "test";
      const encrypted = await encrypt(data, derivedKey);
      const decrypted = await decrypt(encrypted, derivedKey);
      expect(decrypted).toBe(data);
    });

    it("should produce different keys for the same password with different salts", async () => {
      const password = "my-super-secret-password";
      const salt1 = generateSalt();
      const salt2 = generateSalt();

      const derivedKey1 = await deriveKey(password, salt1);
      const derivedKey2 = await deriveKey(password, salt2);

      const exportedKey1 = await exportKey(derivedKey1);
      const exportedKey2 = await exportKey(derivedKey2);

      expect(exportedKey1).not.toEqual(exportedKey2);
    });

    it("should generate a salt of the correct length", () => {
      const salt = generateSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(SALT_LENGTH);
    });
  });

  describe("randomBytes", () => {
    it("should generate a Uint8Array of the specified length", () => {
      const bytes = randomBytes(32);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(32);
    });

    it("should generate different values on subsequent calls", () => {
      const bytes1 = randomBytes(32);
      const bytes2 = randomBytes(32);
      expect(bytes1).not.toEqual(bytes2);
    });

    it("should handle the default length correctly", () => {
      const bytes = randomBytes();
      expect(bytes.length).toBe(32);
    });

    it("should throw an error for invalid length arguments", () => {
      expect(() => randomBytes(0)).toThrow(RangeError);
      expect(() => randomBytes(-1)).toThrow(RangeError);
      expect(() => randomBytes(1.5)).toThrow(TypeError);
      expect(() => randomBytes(65537)).toThrow(RangeError); // Above MAX_BYTES
    });

    it("should have a working custom toString('hex') method", () => {
      const bytes = randomBytes(16);
      const hexString = bytes.toString("hex");
      expect(hexString).toMatch(/^[0-9a-f]{32}$/);
      expect(hexToBuffer(hexString)).toEqual(bytes);
    });

    it("should have a working custom toString('base64') method", () => {
      const bytes = randomBytes(12); // Use multiple of 3 for clean base64
      const base64String = bytes.toString("base64");
      // A simple check to see if it's a valid base64 string
      const base64Regex = /^[A-Za-z0-9+/=]+$/;
      expect(base64Regex.test(base64String)).toBe(true);
    });

    it("should have a working custom toString('utf8') method", () => {
      const originalString = "hello world";
      const bytes = new TextEncoder().encode(originalString);
      // Manually add the method for this test case
      Object.defineProperty(bytes, "toString", {
        value: randomBytes(1).toString,
      });

      expect((bytes as any).toString("utf-8")).toBe(originalString);
    });
  });
});