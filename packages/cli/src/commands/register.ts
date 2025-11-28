import chalk from "chalk";
import { PROJECT_CONFIG_PATH, loadProjectConfig } from "../core/config";
import fs from "fs";
import { Command } from "commander";
import { safePrompt, sanitizeName } from "../utils";
import { password } from "@inquirer/prompts";
import ora from "ora";
import {
  deriveKey,
  encrypt,
  generateRandomKey,
  generateSalt,
  exportKey,
  bufferToHex,
} from "@redenv/core";
import { redis } from "../core/upstash";
import { unlockProject } from "../core/keys";

export function registerCommand(program: Command) {
  program
    .command("register")
    .argument("<project>", "Project name")
    .argument("[env]", "Project environment", "development")
    .option(
      "-l, --history-limit <number>",
      "Number of history entries to keep per secret",
      "10"
    )
    .description("Register a new project or connect to an existing one")
    .action(action);
}

export const action = async (
  project: string,
  env: string,
  options: any
) => {
  const sanitizedProject = sanitizeName(project);
  const sanitizedEnv = sanitizeName(env);

  if (
    project !== sanitizedProject ||
    env !== sanitizedEnv
  ) {
    console.log(
      chalk.yellow(
        "Colons (:) are not allowed in names and have been replaced with hyphens (-)."
      )
    );
  }

  const localConfig = loadProjectConfig();
  if (localConfig && localConfig.name === sanitizedProject) {
    console.log(
      chalk.yellow(
        `This directory is already registered with project "${sanitizedProject}".`
      )
    );
    return;
  }

  const spinner = ora("Checking project status...").start();
  const metaKey = `meta@${sanitizedProject}`;
  const projectExists = (await redis.exists(metaKey)) > 0;
  spinner.stop();

  // --- Flow for connecting to an EXISTING remote project ---
  if (projectExists) {
    console.log(
      chalk.blue(`Project "${sanitizedProject}" already exists remotely.`)
    );
    if (!options.pek) await unlockProject(sanitizedProject as string); // This verifies the password

    const data = {
      name: sanitizedProject,
      environment: sanitizedEnv,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(PROJECT_CONFIG_PATH, JSON.stringify(data, null, 2));
    console.log(
      chalk.green(
        `\n✔ Successfully connected local directory to project "${sanitizedProject}".`
      )
    );
    return;
  }

  // --- Flow for creating a NEW project ---
  console.log(chalk.blue(`Creating new project "${sanitizedProject}"...`));
  const masterPassword = await safePrompt(() =>
    password({
      message: `Create a Master Password for project "${sanitizedProject}":`,
      mask: "*",
      validate: (p) =>
        p.length >= 8 || "Password must be at least 8 characters long.",
    })
  );
  await safePrompt(() =>
    password({
      message: "Confirm Master Password:",
      mask: "*",
      validate: (value) =>
        value === masterPassword || "Passwords do not match.",
    })
  );

  spinner.start("Encrypting and registering project...");
  try {
    const salt = generateSalt();
    const projectEncryptionKey = await generateRandomKey();
    const passwordDerivedKey = await deriveKey(masterPassword, salt);

    const exportedPEK = await exportKey(projectEncryptionKey);
    const encryptedPEK = await encrypt(exportedPEK, passwordDerivedKey);

    const historyLimit = parseInt(options.historyLimit, 10);
    if (isNaN(historyLimit) || historyLimit < 0) {
      throw new Error("History limit must be a non-negative number.");
    }

    const metadata = {
      encryptedPEK: encryptedPEK,
      salt: bufferToHex(salt as any),
      historyLimit: historyLimit,
      kdf: "pbkdf2",
      algorithm: "aes-256-gcm",
      createdAt: new Date().toISOString(),
    };
    await redis.hset(metaKey, metadata);

    const data = {
      name: sanitizedProject,
      environment: sanitizedEnv,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(PROJECT_CONFIG_PATH, JSON.stringify(data, null, 2));

    spinner.succeed(
      chalk.green(
        `Project "${sanitizedProject}" registered and encrypted successfully!`
      )
    );
    console.log(
      chalk.yellow("  Remember your Master Password. It cannot be recovered.")
    );
  } catch (err) {
    spinner.fail(
      chalk.red(`Failed to register project: ${(err as Error).message}`)
    );
  }
};
