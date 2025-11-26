import {
  deriveKey,
  decrypt,
  importKey,
  hexToBuffer,
  writeSecret,
} from "@redenv/core";
import { Redis } from "@upstash/redis";
import type { LogPreference, RedenvOptions } from "../types";

/**
 * A stateless helper function that fetches and decrypts the Project Encryption Key (PEK).
 *
 * @param redis - An instance of the Upstash Redis client.
 * @param options - The Redenv configuration options.
 * @returns The decrypted PEK as a CryptoKey.
 */
export async function getPEK(
  redis: Redis,
  options: Pick<RedenvOptions, "project" | "tokenId" | "token">
): Promise<CryptoKey> {
  const metaKey = `meta@${options.project}`;
  const metadata = await redis.hgetall<Record<string, any>>(metaKey);
  if (!metadata) throw new Error(`Project "${options.project}" not found.`);

  const serviceTokens =
    typeof metadata.serviceTokens === "string"
      ? JSON.parse(metadata.serviceTokens)
      : metadata.serviceTokens;
  const tokenInfo = serviceTokens?.[options.tokenId];
  if (!tokenInfo) throw new Error("Invalid Redenv Token ID.");

  const salt = hexToBuffer(tokenInfo.salt);
  const tokenKey = await deriveKey(options.token, salt);
  const decryptedPEKHex = await decrypt(tokenInfo.encryptedPEK, tokenKey);

  return importKey(decryptedPEKHex);
}

/**
 * A stateless helper function that fetches all secrets for a given environment,
 * decrypts them, and optionally populates the runtime environment.
 *
 * @param redis - An instance of the Upstash Redis client.
 * @param options - The Redenv configuration options.
 * @returns A record of the decrypted secrets.
 */
export async function fetchAndDecrypt(
  redis: Redis,
  options: Pick<
    RedenvOptions,
    "project" | "tokenId" | "token" | "environment" | "log"
  >
): Promise<Record<string, string>> {
  log("Expired Cache: Fetching secrets from source...", options.log, "high");
  const pek = await getPEK(redis, options);
  const envKey = `${options.environment}:${options.project}`;
  const versionedSecrets = await redis.hgetall<Record<string, any>>(envKey);

  const secrets: Record<string, string> = {};
  if (!versionedSecrets) {
    log("No secrets found for this environment.", options.log);
    return secrets;
  }

  const decryptionPromises = Object.entries(versionedSecrets).map(
    async ([key, history]) => {
      try {
        if (!Array.isArray(history) || history.length === 0) return null;
        const decryptedValue = await decrypt(history[0].value, pek);
        return { key, value: decryptedValue };
      } catch {
        error(`Failed to decrypt secret "${key}".`, options.log);
        return null;
      }
    }
  );

  const decryptedResults = await Promise.all(decryptionPromises);
  for (const result of decryptedResults) {
    if (result) {
      secrets[result.key] = result.value;
    }
  }

  log(
    `Successfully loaded ${Object.keys(secrets).length} secrets.`,
    options.log
  );
  return secrets;
}

/**
 * A stateless helper function that writes a secret to Redis.
 *
 * @param redis - An instance of the Upstash Redis client.
 * @param options - The Redenv configuration options.
 * @param key - The secret key to set.
 * @param value - The new value for the secret.
 */
export async function setSecret(
  redis: Redis,
  options: Pick<RedenvOptions, "project" | "tokenId" | "token" | "environment">,
  key: string,
  value: string
): Promise<void> {
  const pek = await getPEK(redis, options);
  await writeSecret(
    redis,
    options.project,
    options.environment || "development",
    key,
    value,
    pek,
    options.tokenId // Use tokenId for auditing
  );
}

/**
 * Injects secrets into the current runtime's environment.
 * Supports Node.js (`process.env`) and Deno (`Deno.env`).
 */
export async function populateEnv(
  secrets: Record<string, string>,
  options: Pick<RedenvOptions, "log">
): Promise<void> {
  log("Populating environment with secrets...", options.log);
  let injectedCount = 0;

  const isDeno =
    // @ts-expect-error: Check for Deno global
    typeof Deno !== "undefined" && typeof Deno.env !== "undefined";

  for (const key in secrets) {
    if (Object.prototype.hasOwnProperty.call(secrets, key)) {
      const value = secrets[key];
      if (isDeno) {
        // @ts-expect-error: Deno.env.set
        Deno.env.set(key, value);
      } else {
        process.env[key] = value;
      }
      injectedCount++;
    }
  }
  log(`Injection complete. ${injectedCount} variables were set.`, options.log);
}

export function log(
  message: string,
  logPreference: LogPreference = "low",
  priority: Omit<LogPreference, "none"> = "low"
) {
  switch (logPreference) {
    case "low":
      if (priority !== "high") break;
      console.log(`[REDENV] ${message}`);
      break;
    case "high":
      console.log(`[REDENV] ${message}`);
      break;
    case "none":
      break;
  }
}

export function error(message: string, logPreference: LogPreference = "low") {
  if (logPreference !== "none") console.error(`[REDENV] Error: ${message}`);
}