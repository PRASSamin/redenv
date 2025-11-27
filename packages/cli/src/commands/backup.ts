import chalk from "chalk";
import { Command } from "commander";
import { safePrompt } from "../utils";
import { password } from "@inquirer/prompts";
import ora from "ora";
import { deriveKey, encrypt, generateSalt } from "@redenv/core";
import { redis } from "../core/upstash";
import { scanAll } from "../utils/redis";
import fs from "fs";

interface BackupData {
  version: number;
  createdAt: string;
  encryptedData: string;
  salt: string;
}

export function backupCommand(program: Command) {
  program
    .command("backup")
    .description("Create a secure, encrypted backup of your projects")
    .option(
      "-o, --output <file>",
      "Output file for the backup",
      "redenv-backup.enc"
    )
    .option("-p, --project <name>", "Specify a single project to back up")
    .action(action);
}

export const action = async (options: any) => {
  const backupPassword = await safePrompt(() =>
    password({
      message: "Create a password for this backup file:",
      mask: "*",
      validate: (p) =>
        p.length >= 8 || "Password must be at least 8 characters long.",
    })
  );
  await safePrompt(() =>
    password({
      message: "Confirm backup password:",
      mask: "*",
      validate: (value) =>
        value === backupPassword || "Passwords do not match.",
    })
  );

  const spinner = ora("Fetching data from Redis...").start();
  try {
    const dataToBackup: Record<string, Record<string, any>> = {};
    const keysToFetch: string[] = [];

    if (options.project) {
      const projectName = options.project;
      spinner.text = `Fetching data for project "${projectName}"...`;
      const metaKey = `meta@${projectName}`;
      const envKeys = await scanAll(`*:${projectName}`);
      if ((await redis.exists(metaKey)) > 0) {
        keysToFetch.push(metaKey);
      }
      keysToFetch.push(...envKeys);

      if (keysToFetch.length === 0) {
        throw new Error(`Project "${projectName}" not found or has no data.`);
      }
    } else {
      spinner.text = "Discovering all projects...";
      const metaKeys = await scanAll("meta@*");
      const projectNames = metaKeys.map((k) => k.split("@")[1]).filter(Boolean); // Ensure no empty strings

      if (projectNames.length === 0) {
        throw new Error("No projects found to back up.");
      }

      keysToFetch.push(...metaKeys);

      spinner.text = "Fetching data for all projects...";
      for (const projectName of projectNames) {
        const envKeys = await scanAll(`*:${projectName}`);
        keysToFetch.push(...envKeys);
      }
    }

    if (keysToFetch.length === 0) {
      throw new Error("No data found to back up.");
    }

    const pipeline = redis.pipeline();
    for (const key of keysToFetch) {
      pipeline.hgetall(key);
    }
    const results = await pipeline.exec<Record<string, any>[]>();

    for (let i = 0; i < keysToFetch.length; i++) {
      if (results[i]) {
        // @ts-expect-error: Redis pipeline results type mismatch with expected backup data structure
        dataToBackup[keysToFetch[i]] = results[i];
      }
    }

    spinner.text = "Encrypting backup data...";
    const salt = generateSalt();
    const backupKey = await deriveKey(backupPassword, salt);
    const encryptedData = await encrypt(
      JSON.stringify(dataToBackup),
      backupKey
    );

    const backupFile: BackupData = {
      version: 1,
      createdAt: new Date().toISOString(),
      salt: Buffer.from(salt).toString("hex"),
      encryptedData,
    };

    fs.writeFileSync(options.output, JSON.stringify(backupFile, null, 2));

    spinner.succeed(
      `Successfully created encrypted backup at ${options.output}`
    );
  } catch (err) {
    const error = err as Error;
    if (spinner.isSpinning) {
      spinner.fail(chalk.red(error.message));
    }
    
    if (process.env.REDENV_SHELL_ACTIVE) {
      throw error;
    }

    if (error.name !== "ExitPromptError") {
      console.log(
        chalk.red(`\n✘ An unexpected error occurred: ${error.message}`)
      );
    }
    process.exit(1);
  }
};
