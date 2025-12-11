import type { Redis } from "@upstash/redis";
import { encrypt } from "./crypto";
import type { EnvironmentVariableValue } from "./types";
import { RedenvError } from "./error";

/**
 * Handles the complete "read-modify-write" cycle for updating a secret's
 * version history in Redis. This performs an "upsert" operation.
 *
 * @param redis An instance of the Upstash Redis client.
 * @param projectName The name of the project.
 * @param environment The environment to write to.
 * @param key The secret key to write.
 * @param newValue The new plaintext value for the secret.
 * @param pek The Project Encryption Key (CryptoKey) for encrypting the value.
 * @param user A string identifying the user or service performing the action, for auditing.
 */
export async function writeSecret(
  redis: Redis,
  projectName: string,
  environment: string,
  key: string,
  newValue: string,
  pek: CryptoKey,
  user: string
) {
  const redisKey = `${environment}:${projectName}`;
  const metaKey = `meta@${projectName}`;

  // Fetch metadata and the current secret history in parallel
  const [metadata, currentHistory] = await Promise.all([
    redis.hgetall<{ historyLimit?: number }>(metaKey),
    redis.hget(redisKey, key) as Promise<EnvironmentVariableValue | null>,
  ]);

  if (!metadata) {
    throw new RedenvError(
      `Could not retrieve metadata for project "${projectName}". The project may not exist.`,
      "PROJECT_NOT_FOUND"
    );
  }

  const history = Array.isArray(currentHistory) ? currentHistory : [];
  const lastVersion = history[0]?.version || 0;

  const newVersion = {
    version: lastVersion + 1,
    value: await encrypt(newValue, pek),
    user: user,
    createdAt: new Date().toISOString(),
  };

  history.unshift(newVersion);

  // Enforce the history limit
  const limit = metadata.historyLimit ?? 10;
  const trimmedHistory = limit > 0 ? history.slice(0, limit) : history;

  const valueToStore = JSON.stringify(trimmedHistory);
  await redis.hset(redisKey, { [key]: valueToStore });
}
