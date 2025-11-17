import { password, confirm } from "@inquirer/prompts";
import { safePrompt } from "../utils";
import { redis } from "./upstash";
import { deriveKey, decrypt } from "./crypto";
import ora from "ora";
import keytar from "keytar";
import chalk from "chalk";

const KEYTAR_SERVICE = "redenv-cli";

// A simple in-memory cache for the unlocked PEK to avoid asking for the password repeatedly
// for commands that might perform multiple operations.
const keyCache = new Map<string, Buffer>();

/**
 * Unlocks a project's Project Encryption Key (PEK) by checking the OS keychain,
 * or prompting for the master password as a fallback.
 * Caches the key in memory for the lifetime of the CLI process.
 * @param projectName The name of the project to unlock.
 * @returns The decrypted Project Encryption Key as a Buffer.
 */
export async function unlockProject(projectName: string): Promise<Buffer> {
  // 1. Check in-memory cache first
  if (keyCache.has(projectName)) {
    return keyCache.get(projectName)!;
  }

  // 2. Check OS keychain
  const cachedPEKHex = await keytar.getPassword(KEYTAR_SERVICE, projectName);
  if (cachedPEKHex) {
    const pek = Buffer.from(cachedPEKHex, "hex");
    keyCache.set(projectName, pek);
    return pek;
  }

  // 3. Fallback to prompting for master password
  const masterPassword = await safePrompt(() =>
    password({
      message: `Enter Master Password for project "${projectName}":`,
      mask: "*",
    })
  );

  const spinner = ora("Decrypting project key...").start();

  try {
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

    const salt = Buffer.from(metadata.salt, "hex");
    const passwordDerivedKey = await deriveKey(masterPassword, salt);
    const decryptedPEKHex = decrypt(metadata.encryptedPEK, passwordDerivedKey);
    const pek = Buffer.from(decryptedPEKHex, "hex");

    spinner.succeed("Project unlocked successfully");

    // 4. Offer to save the key to the keychain for next time
    const shouldCache = await safePrompt(() =>
      confirm({
        message: "Remember password for this project in your OS keychain?",
        default: true,
      })
    );

    if (shouldCache) {
      await keytar.setPassword(KEYTAR_SERVICE, projectName, pek.toString("hex"));
      console.log(chalk.green("✔ Password remembered for future sessions."));
      console.log(chalk.gray("  (Use `redenv logout` to forget)"));
    }

    // 5. Cache in memory for the current session
    keyCache.set(projectName, pek);

    return pek;
  } catch (err) {
    spinner.fail(
      err instanceof Error ? err.message : "An unknown error occurred."
    );
    process.exit(1);
  }
}

/**
 * Removes a project's cached PEK from the OS keychain.
 * @param projectName The name of the project to log out from.
 */
export async function forgetProjectKey(projectName: string): Promise<boolean> {
    keyCache.delete(projectName);
    return keytar.deletePassword(KEYTAR_SERVICE, projectName);
}
