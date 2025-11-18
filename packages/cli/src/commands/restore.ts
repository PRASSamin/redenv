import chalk from "chalk";
import { Command } from "commander";
import { safePrompt } from "../utils";
import { confirm, password } from "@inquirer/prompts";
import ora from "ora";
import { deriveKey, decrypt } from "../core/crypto";
import { redis } from "../core/upstash";
import fs from "fs";

interface BackupData {
  version: number;
  createdAt: string;
  encryptedData: string;
  salt: string;
}

export function restoreCommand(program: Command) {
  program
    .command("restore")
    .argument("<file>", "The backup file to restore from")
    .description("Restore projects from a secure, encrypted backup file")
    .action(async (filePath) => {
      if (!fs.existsSync(filePath)) {
        console.log(chalk.red(`✘ Backup file not found at ${filePath}`));
        return;
      }

      const backupPassword = await safePrompt(() =>
        password({
          message: "Enter the password for this backup file:",
          mask: "*",
        })
      );

      const spinner = ora("Reading and decrypting backup file...").start();
      try {
        const fileContent = fs.readFileSync(filePath, "utf8");
        const backupFile: BackupData = JSON.parse(fileContent);

        const salt = Buffer.from(backupFile.salt, "hex");
        const backupKey = await deriveKey(backupPassword, salt);
        const decryptedData = await decrypt(backupFile.encryptedData, backupKey);
        const dataToRestore: Record<string, Record<string, any>> =
          JSON.parse(decryptedData);
        
        spinner.succeed("Backup file decrypted successfully.");

        const keysToRestore = Object.keys(dataToRestore);
        const projectsInBackup: Record<
          string,
          { environments: string[]; hasMeta: boolean }
        > = {};

        for (const key of keysToRestore) {
          if (key.includes("@")) {
            const projectName = key.split("@")[1];
            if (!projectsInBackup[projectName]) {
              projectsInBackup[projectName] = {
                environments: [],
                hasMeta: false,
              };
            }
            projectsInBackup[projectName].hasMeta = true;
          } else if (key.includes(":")) {
            const [environment, projectName] = key.split(":");
            if (!projectsInBackup[projectName]) {
              projectsInBackup[projectName] = {
                environments: [],
                hasMeta: false,
              };
            }
            projectsInBackup[projectName].environments.push(environment);
          }
        }

        let displayString = chalk.cyan(
          "\nBackup file contains the following data:\n"
        );
        for (const projectName in projectsInBackup) {
          const projectData = projectsInBackup[projectName];
          displayString += `\n  ${chalk.bold.yellow(projectName)}`;
          projectData.environments
            .sort()
            .forEach((env) => (displayString += `\n    - ${env}`));
          if (projectData.hasMeta) {
            displayString += `\n    ${chalk.gray("- (Project Metadata)")}`;
          }
        }
        console.log(displayString);

        const confirmation = await safePrompt(() =>
          confirm({
            message: chalk.yellow.bold(
              `\nThis will overwrite any conflicting data in Redis. This action cannot be undone. Are you sure?`
            ),
            default: false,
          })
        );

        if (!confirmation) {
          console.log(chalk.yellow("✘ Restore operation cancelled."));
          return;
        }

        const restoreSpinner = ora("Restoring data to Redis...").start();
        const pipeline = redis.pipeline();
        for (const key of keysToRestore) {
          pipeline.del(key);
          // The values in the backup are already objects/arrays, but hset needs strings.
          // We must stringify them before restoring.
          const stringifiedValues: Record<string, string> = {};
          for (const field in dataToRestore[key]) {
            stringifiedValues[field] = JSON.stringify(dataToRestore[key][field]);
          }
          pipeline.hset(key, stringifiedValues);
        }
        await pipeline.exec();

        restoreSpinner.succeed(
          `Successfully restored data for ${keysToRestore.length} keys.`
        );

      } catch (err) {
        if (spinner.isSpinning) {
          spinner.fail(chalk.red((err as Error).message));
        } else if ((err as Error).name !== 'ExitPromptError') {
          console.log(chalk.red(`\n✘ An unexpected error occurred: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });
}