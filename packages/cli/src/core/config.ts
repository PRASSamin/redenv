import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { sanitizeName } from "../utils"; // Assuming this exists
// CHANGED: Switched to async version
import { lilconfig } from "lilconfig";
import { createJiti } from "jiti";

export const GLOBAL_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "redenv.config.json"
);
// Note: This constant isn't strictly used by lilconfig (it searches), 
// but useful for referencing where a default might go.
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

export type ProjectConfig = {
  name: string;
  environment: string;
  _filepath?: string; // Internal use
  [key: string]: any;
};

// Loader for dynamic JS/TS config files
const jitiLoader = createJiti(import.meta.url, { interopDefault: true });

async function loadJiti(filepath: string) {
  const mod = await jitiLoader.import(filepath);
  // Jiti v2 with interopDefault: true usually returns the module export. 
  // Depending on how the user exports, it might be mod or mod.default.
  // The 'interopDefault' flag handles most cases, but good to be safe:
  return (mod as any).default || mod;
}

export function loadMemoryConfig(): Credential[] {
  if (!fs.existsSync(MEMORY_CONFIG_PATH)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(MEMORY_CONFIG_PATH, "utf-8");
    if (!raw.trim()) return []; // Handle whitespace-only files
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveToMemoryConfig(newCredential: Credential) {
  const memory = loadMemoryConfig();

  // FIXED: Check if the specific PAIR exists
  const exists = memory.some(
    (cred) => cred.url === newCredential.url && cred.token === newCredential.token
  );

  if (exists) {
    return;
  }

  const updatedMemory = [...memory, newCredential];

  try {
    // Ensure directory exists first
    const dir = path.dirname(MEMORY_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(
      MEMORY_CONFIG_PATH,
      JSON.stringify(updatedMemory, null, 2)
    );
  } catch (err) {
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
    // Return null or throw? Throwing forces the user to run setup.
    throw new Error("Config not found! Run 'redenv setup' first.");
  }
  try {
    const raw = fs.readFileSync(GLOBAL_CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to load global config: ${(err as Error).message}`);
  }
}

// CHANGED: This must be async to support TS/JS config loading via Jiti
export async function loadProjectConfig(): Promise<ProjectConfig | undefined> {
  const moduleName = "redenv";
  
  // CHANGED: lilconfig (async) instead of lilconfigSync
  const explorer = lilconfig(moduleName, {
    searchPlaces: [
      `${moduleName}.config.js`,
      `${moduleName}.config.ts`,
      `${moduleName}.config.mjs`,
      `${moduleName}.config.cjs`,
      `${moduleName}.config.json`,
      "package.json", // Optional: check package.json property
    ],
    loaders: {
      ".js": loadJiti,
      ".ts": loadJiti,
      ".mjs": loadJiti,
      ".cjs": loadJiti,
    },
  });

  try {
    const result = await explorer.search();
    if (!result || !result.config) return undefined;

    const config = result.config as ProjectConfig;
    const configPath = result.filepath;

    const originalName = config.name;
    const originalEnv = config.environment;

    // Safety check: ensure these fields exist before sanitizing
    const sanitizedName = originalName ? sanitizeName(originalName) : undefined;
    const sanitizedEnv = originalEnv ? sanitizeName(originalEnv) : undefined;

    let updated = false;

    if (originalName && sanitizedName !== originalName) {
      config.name = sanitizedName!;
      updated = true;
    }
    if (originalEnv && sanitizedEnv !== originalEnv) {
      config.environment = sanitizedEnv!;
      updated = true;
    }

    if (updated) {
      console.log(
        chalk.yellow(
          "Warning: Project config contains colons (:), which are not allowed. They have been automatically replaced with hyphens (-)."
        )
      );

      if (configPath.endsWith(".json")) {
        // Only safe to write back to JSON automatically
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      } else {
        console.log(
          chalk.yellow(
            `Please update your configuration file (${path.basename(
              configPath
            )}) manually to remove colons.`
          )
        );
      }
    }

    // Inject path for utils
    Object.defineProperty(config, "_filepath", {
      value: configPath,
      enumerable: false,
      writable: true,
    });

    return config;
  } catch (err) {
    throw new Error(`Failed to load project config: ${(err as Error).message}`);
  }
}