import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { sanitizeName } from "../utils";

export const GLOBAL_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "redenv.config.json"
);
export const PROJECT_CONFIG_PATH = "redenv.config.json";
export const MEMORY_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "redenv.memory.json"
);
export const HISTORY_FILE_PATH = path.join(os.homedir(), ".redenv_history");

export type Credential = {
  url: string;
  token: string;
  createdAt: string;
};

export function loadMemoryConfig(): Credential[] {
  if (!fs.existsSync(MEMORY_CONFIG_PATH)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(MEMORY_CONFIG_PATH, "utf-8");
    // handle empty file
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    // If file is corrupt or empty, treat as no memory
    return [];
  }
}

export function saveToMemoryConfig(newCredential: Credential) {
  const memory = loadMemoryConfig();

  // Don't save if the URL already exists
  if (
    memory.some((cred) => cred.url === newCredential.url) &&
    memory.some((cred) => cred.token === newCredential.token)
  ) {
    return;
  }

  const updatedMemory = [...memory, newCredential];

  try {
    fs.writeFileSync(
      MEMORY_CONFIG_PATH,
      JSON.stringify(updatedMemory, null, 2)
    );
  } catch (err) {
    // Fail silently if memory can't be saved, it's a non-critical feature.
    console.log(
      chalk.yellow(
        `Warning: Could not save credentials to memory file. ${
          (err as Error).message
        }`
      )
    );
  }
}

export function loadGlobalConfig() {
  if (!fs.existsSync(GLOBAL_CONFIG_PATH)) {
    throw new Error("Config not found! Run 'redenv setup' first.");
  }
  try {
    const raw = fs.readFileSync(GLOBAL_CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to load global config: ${(err as Error).message}`);
  }
}

export function loadProjectConfig() {
  if (!fs.existsSync(PROJECT_CONFIG_PATH)) return;
  try {
    const raw = fs.readFileSync(PROJECT_CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);

    const originalName = config.name;
    const originalEnv = config.environment;

    const sanitizedName = sanitizeName(originalName);
    const sanitizedEnv = sanitizeName(originalEnv);

    let updated = false;
    if (sanitizedName !== originalName) {
      config.name = sanitizedName;
      updated = true;
    }
    if (sanitizedEnv !== originalEnv) {
      config.environment = sanitizedEnv;
      updated = true;
    }

    if (updated) {
      console.log(
        chalk.yellow(
          "Warning: Project config contains colons (:), which are not allowed. They have been automatically replaced with hyphens (-)."
        )
      );
      fs.writeFileSync(PROJECT_CONFIG_PATH, JSON.stringify(config, null, 2));
    }

    return config;
  } catch (err) {
    throw new Error(`Failed to load project config: ${(err as Error).message}`);
  }
}
