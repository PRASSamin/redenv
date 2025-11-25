import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { redis } from "../core/upstash";
import ora from "ora";
import Table from "cli-table3";
import { select } from "@inquirer/prompts";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments } from "../utils/redis";
import { unlockProject } from "../core/keys";
import { type CryptoKey, decrypt } from "@redenv/core";

async function fetchAndDisplayVariables(
  redisKey: string,
  decryptionKey: CryptoKey
) {
  const [environment, projectName] = redisKey.split(":");
  const spinner = ora(
    `Fetching variables for ${projectName} (${environment})...`
  ).start();
  try {
    // The `hgetall` method from `@upstash/redis` automatically parses JSON strings into objects.
    const envs = await redis.hgetall<Record<string, any>>(redisKey);
    spinner.stop();

    if (!envs || Object.keys(envs).length === 0) {
      console.log(
        chalk.yellow(
          `No variables found for project ${projectName} (${environment}).`
        )
      );
      return;
    }

    console.log(
      chalk.cyan.bold(`\n📦 Variables for ${projectName} (${environment}):\n`)
    );

    const table = new Table({
      head: [chalk.cyanBright("KEY"), chalk.greenBright("VALUE")],
      colWidths: [28, 50],
      style: { head: [], border: [] },
    });

    const sorted = Object.entries(envs).sort(([a], [b]) => a.localeCompare(b));

    // Decrypt all values in parallel for performance
    const decryptionPromises = sorted.map(async ([key, history]) => {
      try {
        if (!Array.isArray(history) || history.length === 0) {
          throw new Error("Invalid history format");
        }
        const latestVersion = history[0];
        const decryptedValue = await decrypt(
          latestVersion.value,
          decryptionKey
        );
        return [key, decryptedValue];
      } catch (e) {
        return [key, chalk.yellow(`[Corrupted or invalid data]`)];
      }
    });

    const decryptedRows = await Promise.all(decryptionPromises);

    for (const [key, decryptedValue] of decryptedRows) {
      table.push([
        chalk.blue(key as string),
        chalk.green(decryptedValue as string),
      ]);
    }

    console.log(table.toString());
  } catch (err) {
    spinner.fail(
      chalk.red(`Failed to fetch variables: ${(err as Error).message}`)
    );
  }
}

export function listCommand(program: Command) {
  program
    .command("list")
    .description("List all ENV variables for a project")
    .option("-p, --project <name>", "Specify project name")
    .option("-e, --env <env>", "Specify the environment")
    .action(async (options) => {
      const projectConfig = loadProjectConfig();
      const projectOption = sanitizeName(options.project);
      const envOption = sanitizeName(options.env);

      const projectName = projectOption || projectConfig?.name;
      if (!projectName) {
        console.log(
          chalk.red(
            "No project specified. Use `redenv list -p <project-name>` or run from a registered project directory."
          )
        );
        return;
      }

      try {
        const pek = await unlockProject(projectName);
        let environment = envOption || projectConfig?.environment;

        if (!environment) {
          const envs = await fetchEnvironments(projectName, true);
          if (envs.length === 0) {
            console.log(
              chalk.yellow(
                `No environments found for project "${projectName}".`
              )
            );
            return;
          }
          environment = await safePrompt(() =>
            select({
              message: "Select environment:",
              choices: envs.map((e) => ({ name: e, value: e })),
            })
          );
        }

        const redisKey = `${environment}:${projectName}`;
        await fetchAndDisplayVariables(redisKey, pek);
      } catch (err) {
        // Errors from unlockProject are handled, so we don't need to log them again
        if ((err as Error).name !== "ExitPromptError") {
          console.log(
            chalk.red(
              `\n✘ An unexpected error occurred: ${(err as Error).message}`
            )
          );
        }
      }
    });
}
