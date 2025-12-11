import ora from "ora";
import { redis } from "../core/upstash";
import chalk from "chalk";
import { exit } from "process";
import { RedenvError } from "@redenv/core";

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

    const envs = Array.from(
      new Set(
        keys
          .map((k) => k.split(":")[0])
          .filter((k): k is string => k !== undefined)
      )
    );

    return envs;
  } catch (err) {
    spinner.fail();
    throw new RedenvError(`Failed to fetch environments: ${(err as Error).message}`, "UNKNOWN_ERROR");
  }
};

export const fetchProjects = async (): Promise<string[]> => {
  const spinner = ora("Fetching projects...").start();
  try {
    const keys = await scanAll("*@*");
    spinner.stop();

    return Array.from(
      new Set(
        keys
          .map((k) => k.split("@")[1])
          .filter((k): k is string => k !== undefined)
      )
    );
  } catch (err) {
    spinner.fail();
    throw new RedenvError(`Failed to fetch projects: ${(err as Error).message}`, "UNKNOWN_ERROR");
  }
};
