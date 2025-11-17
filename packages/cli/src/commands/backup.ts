import chalk from "chalk";
import { Command } from "commander";
import { safePrompt } from "../utils";
import { password } from "@inquirer/prompts";
import ora from "ora";
import { deriveKey, encrypt, generateSalt } from "../core/crypto";
import { redis } from "../core/upstash";
import { fetchProjects, scanAll } from "../utils/redis";
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
    .option("-o, --output <file>", "Output file for the backup", "redenv-backup.enc")
    .option("-p, --project <name>", "Specify a single project to back up")
    .action(async (options) => {
      const backupPassword = await safePrompt(() =>
        password({
          message: "Create a password for this backup file:",
          mask: "*",
          validate: (p) => p.length >= 8 || "Password must be at least 8 characters long.",
        })
      );
      await safePrompt(() =>
        password({
          message: "Confirm backup password:",
          mask: "*",
          validate: (value) => value === backupPassword || "Passwords do not match.",
        })
      );

      const spinner = ora("Fetching data from Redis...").start();
      try {
        const dataToBackup: Record<string, Record<string, string>> = {};
        let keysToFetch: string[] = [];

        if (options.project) {
          const projectName = options.project;
          spinner.text = `Fetching data for project "${projectName}"...`;
          const metaKey = `meta@${projectName}`;
          const envKeys = await scanAll(`*:${projectName}`);
          if ((await redis.exists(metaKey)) > 0) {
            keysToFetch.push(metaKey, ...envKeys);
          } else if (envKeys.length > 0) {
            keysToFetch.push(...envKeys);
          } else {
            throw new Error(`Project "${projectName}" not found.`);
          }
        } else {
          spinner.text = "Fetching data for all projects...";
          const projects = await fetchProjects();
          if (projects.length === 0) {
            throw new Error("No projects found to back up.");
          }
          const allKeys = await Promise.all(
            projects.map(async (p) => {
              const metaKey = `meta@${p}`;
              const envKeys = await scanAll(`*:${p}`);
              return [metaKey, ...envKeys];
            })
          );
          keysToFetch = allKeys.flat();
        }

        if (keysToFetch.length === 0) {
          throw new Error("No data found to back up.");
        }
        
        const pipeline = redis.pipeline();
        for (const key of keysToFetch) {
          pipeline.hgetall(key);
        }
        const results = await pipeline.exec<Record<string, string>[]>();

        for (let i = 0; i < keysToFetch.length; i++) {
          if (results[i]) {
            dataToBackup[keysToFetch[i]] = results[i];
          }
        }

        spinner.text = "Encrypting backup data...";
        const salt = generateSalt();
        const backupKey = await deriveKey(backupPassword, salt);
        const encryptedData = encrypt(JSON.stringify(dataToBackup), backupKey);

        const backupFile: BackupData = {
          version: 1,
          createdAt: new Date().toISOString(),
          salt: salt.toString("hex"),
          encryptedData,
        };

        fs.writeFileSync(options.output, JSON.stringify(backupFile, null, 2));

        spinner.succeed(
          chalk.green(`✔ Successfully created encrypted backup at ${options.output}`)
        );
      } catch (err) {
        if (spinner.isSpinning) {
          spinner.fail(chalk.red((err as Error).message));
        } else {
          console.log(chalk.red(`\n✘ An unexpected error occurred: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });
}
