import chalk from "chalk";
import { exit } from "process";
import { loadGlobalConfig, loadProjectConfig } from "../core/config";
import fs from "fs";
import os from "os";

export const UserCancelledError = "PROMPT_CANCELLED_BY_USER";

export class ContextSwitchRequest extends Error {
  public readonly newProject?: string;
  public readonly newEnv?: string;

  constructor(
    message: string,
    newContext: { newProject?: string; newEnv?: string }
  ) {
    super(message);
    this.name = "ContextSwitchRequest";
    this.newProject = newContext.newProject;
    this.newEnv = newContext.newEnv;
  }
}

export async function safePrompt<T>(promptFn: () => Promise<T>): Promise<T> {
  try {
    return await promptFn();
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "ExitPromptError")
    ) {
      console.log(chalk.yellow("\nCancelled")); // Add newline for better formatting
      if (process.env.REDENV_SHELL_ACTIVE) {
        throw new Error(UserCancelledError);
      } else {
        exit(0);
      }
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
  } catch {
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

export const writeProjectConfig = async (config: Record<string, unknown>) => {
  const currentConfig = await loadProjectConfig();
  const existingPath = currentConfig?._filepath;

  // SCENARIO 1: Existing JSON Config -> Safe to Merge & Write
  if (existingPath && existingPath.endsWith(".json")) {
    let existingContent: Record<string, unknown> = {};
    try {
      existingContent = JSON.parse(fs.readFileSync(existingPath, "utf8"));
    } catch (err) {
      throw new Error(
        `Failed to read project config: ${(err as Error).message}`
      );
    }

    const newContent = sortObject({ ...existingContent, ...config });
    
    // Safety: ensure internal keys don't leak into the file
    delete newContent._filepath; 

    fs.writeFileSync(existingPath, JSON.stringify(newContent, null, 2));
    console.log(chalk.green(`✔ Updated configuration: ${existingPath}`));
    return;
  }

  // SCENARIO 2: Existing JS/TS Config -> Unsafe to Write
  if (existingPath) {
    console.log(
      chalk.yellow(
        `⚠  Configuration found at ${existingPath}.\n` +
        `   Automatic updates are only supported for JSON files.\n` +
        `   Please update this file manually.` + 
        `\n` +
        `Changes that were skipped: ${JSON.stringify(config, null, 2)}`
      )
    );
    return;
  }

  // SCENARIO 3: No Config -> Create New Defaults (TS)
  const targetPath = "redenv.config.ts";

  // Double check file doesn't exist (in case lilconfig missed it or race condition)
  if (fs.existsSync(targetPath)) {
    console.log(chalk.yellow(`⚠  ${targetPath} already exists. Skipping creation.`));
    return;
  }

  // We don't merge 'currentConfig' here because if we reached this point, 
  // currentConfig is undefined (no config found).
  const configContent = sortObject({
    name: config.name,
    environment: config.environment || "development",
    ...config,
  });

  const tsContent = `import { defineConfig } from "@redenv/core";

export default defineConfig(${JSON.stringify(configContent, null, 2)});
`;

  fs.writeFileSync(targetPath, tsContent);
  console.log(chalk.green(`✔ Created new configuration file: ${targetPath}`));
};

function sortObject(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).sort((a, b) => a[0].localeCompare(b[0]))
  );
}