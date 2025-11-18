import ora from "ora";
import { redis } from "../core/upstash";
import chalk from "chalk";
import { exit } from "process";
import { getAuditUser } from "./index";
import { type CryptoKey, encrypt } from "../core/crypto";
import { EnvironmentVariableValue } from "../types";

export async function scanAll(match: string, count = 100): Promise<string[]> {
  let cursor = 0;
  const keys: string[] = [];

  do {
    const [nextCursor, batch] = await redis.scan(cursor, {
      match,
      count,
    });

    cursor = Number(nextCursor);
    keys.push(...batch);
  } while (cursor !== 0);

  return keys;
}

export const fetchEnvironments = async (
  namespace: string,
  terminate = false
): Promise<string[]> => {
  const spinner = ora("Fetching environments...").start();

  try {
    const pattern = namespace ? `*:${namespace}` : "*:*";
    const keys = await scanAll(pattern);

    spinner.stop();

    if (keys.length === 0 && terminate) {
      console.log(
        chalk.yellow(`No environments found for project "${namespace}".`)
      );
      exit(0);
    }

    const envs = Array.from(new Set(keys.map((k) => k.split(":")[0])));

    return envs;
  } catch (err) {
    spinner.fail();
    throw new Error(`Failed to fetch environments: ${(err as Error).message}`);
  }
};

export const fetchProjects = async (): Promise<string[]> => {
  const spinner = ora("Fetching projects...").start();
  try {
    const keys = await scanAll("*@*");
    spinner.stop();

    return Array.from(new Set(keys.map((k) => k.split("@")[1])));
  } catch (err) {
    spinner.fail();
    throw new Error(`Failed to fetch projects: ${(err as Error).message}`);
  }
};

/**
 * Handles the complete "read-modify-write" cycle for updating a secret's
 * version history.
 */
export async function writeSecret(
  projectName: string,
  environment: string,
  key: string,
  newValue: string,
  pek: CryptoKey,
  options: { isNew: boolean }
) {
  const redisKey = `${environment}:${projectName}`;

  const exists = (await redis.hexists(redisKey, key)) > 0;

  if (options.isNew && exists) {
    throw new Error(
      `Key '${key}' already exists. Use 'redenv edit' to update it.`
    );
  }
  if (!options.isNew && !exists) {
    throw new Error(
      `Key '${key}' does not exist. Use 'redenv add' to create it.`
    );
  }

  const metaKey = `meta@${projectName}`;
  const [metadata, currentHistory] = await Promise.all([
    redis.hgetall<{ historyLimit?: number }>(metaKey),
    redis.hget(redisKey, key) as Promise<EnvironmentVariableValue | null>,
  ]);

  const history = Array.isArray(currentHistory) ? currentHistory : [];
  const lastVersion = history[0]?.version || 0;
  const user = getAuditUser();

  const newVersion = {
    version: lastVersion + 1,
    value: await encrypt(newValue, pek),
    user: user,
    createdAt: new Date().toISOString(),
  };

  history.unshift(newVersion);

  const limit = metadata?.historyLimit ?? 10;
  const trimmedHistory = limit > 0 ? history.slice(0, limit) : history;

  const valueToStore = JSON.stringify(trimmedHistory);
  await redis.hset(redisKey, { [key]: valueToStore });
}
