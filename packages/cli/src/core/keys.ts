import { password } from "@inquirer/prompts";
import { safePrompt } from "../utils";
import { redis } from "./upstash";
import { deriveKey, decrypt } from "./crypto";
import ora from "ora";

// A simple in-memory cache for the unlocked PEK to avoid asking for the password repeatedly
// for commands that might perform multiple operations.
const keyCache = new Map<string, Buffer>();

/**
 * Unlocks a project's Project Encryption Key (PEK) by prompting for the master password.
 * Caches the key in memory for the lifetime of the CLI process.
 * @param projectName The name of the project to unlock.
 * @returns The decrypted Project Encryption Key as a Buffer.
 */
export async function unlockProject(projectName: string): Promise<Buffer> {
  if (keyCache.has(projectName)) {
    return keyCache.get(projectName)!;
  }

  const masterPassword = await safePrompt(() =>
    password({
      message: `Enter Master Password for project "${projectName}":`,
      mask: "*",
    })
  );

  const spinner = ora("Decrypting project key...").start();

  try {
    // 1. Fetch metadata from Redis
    const metaKey = `meta@${projectName}`;
    const metadata = await redis.hgetall<{
      encryptedPEK: string;
      salt: string;
    }>(metaKey);

    if (!metadata || !metadata.encryptedPEK || !metadata.salt) {
      throw new Error(
        `Could not find encryption metadata for project "${projectName}". The project may not be registered correctly.`
      );
    }

    // 2. Derive key from password and salt
    const salt = Buffer.from(metadata.salt, "hex");
    const passwordDerivedKey = await deriveKey(masterPassword, salt);

    // 3. Decrypt the PEK
    const decryptedPEKHex = decrypt(metadata.encryptedPEK, passwordDerivedKey);
    const pek = Buffer.from(decryptedPEKHex, "hex");

    spinner.succeed("Project unlocked successfully");

    // 4. Cache the unlocked key for future use in this session
    keyCache.set(projectName, pek);

    return pek;
  } catch (err) {
    spinner.fail(
      err instanceof Error ? err.message : "An unknown error occurred."
    );
    // Exit gracefully if we fail to unlock, to prevent further command execution
    process.exit(1);
  }
}
