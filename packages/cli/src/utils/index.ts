import chalk from "chalk";
import ora from "ora";
import { exit } from "process";
import { PROJECT_CONFIG_PATH, loadGlobalConfig } from "../core/config";
import fs from "fs";
import os from "os";

export async function safePrompt<T>(promptFn: () => Promise<T>): Promise<T> {
  try {
    return await promptFn();
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "ExitPromptError")
    ) {
      console.log(chalk.yellow("Cancelled"));
      exit(1);
    }
    throw err;
  }
}

export function getAuditUser(): string {
  const globalConfig = loadGlobalConfig();
  if (globalConfig && globalConfig.email) {
    return globalConfig.email;
  }
  try {
    const userInfo = os.userInfo();
    const hostname = os.hostname();
    return `${userInfo.username}@${hostname}`;
  } catch (e) {
    // Failsafe in very restricted environments
    return "unknown-user";
  }
}

export const normalize = (val: any): string => {
  if (val === undefined || val === null) return "";
  return val.toString().trim().replace(/\r\n/g, "\n");
};

export const sanitizeName = (name: string | undefined) => {
  if (!name) return name;
  return name.replace(/:/g, "-");
};

export const nameValidator = (input: string) => {
  if (input.includes(":")) {
    return "Project and environment names cannot contain colons (:).";
  }
  return true;
};

export const writeProjectConfig = (config: Record<string, unknown>) => {
  let existingConfig: Record<string, unknown> = {};
  if (fs.existsSync(PROJECT_CONFIG_PATH)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(PROJECT_CONFIG_PATH, "utf8"));
    } catch (err) {
      throw new Error(
        `Failed to read project config: ${(err as Error).message}`
      );
    }
  }
  fs.writeFileSync(
    PROJECT_CONFIG_PATH,
    JSON.stringify({ ...existingConfig, ...config }, null, 2)
  );
};
