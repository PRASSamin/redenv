import chalk from "chalk";
import ora from "ora";
import { redis } from "../core/upstash";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { select, checkbox } from "@inquirer/prompts";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments } from "../utils/redis";

export function removeCommand(program: Command) {
  program
    .command("remove")
    .argument("[key]", "ENV key to remove")
    .description("Remove one or more keys from the project in Upstash")
    .option("-p, --project <name>", "Specify project name")
    .option("-e, --env <env>", "Specify environment")
    .action(async (key, options) => {
      const projectConfig = loadProjectConfig();
      if (!projectConfig && !options.project) {
        console.log(
          chalk.red(
            "✘ No project registered. Use `redenv register <name>` or pass `--project <name>`."
          )
        );
        return;
      }

      const projectName = sanitizeName(options.project) || projectConfig?.name;
      let environment = sanitizeName(options.env) || projectConfig?.environment;

      if (!environment) {
        const envs = await fetchEnvironments(projectName, true);
        environment = await safePrompt(() =>
          select({
            message: "Select environment:",
            choices: envs,
          })
        );
      }

      // Determine which keys to delete
      let keysToDelete: string[] = [];

      if (!key) {
        const spinner = ora(
          `Fetching all keys from ${projectName} (${environment})...`
        ).start();

        try {
          const redisKey = `${environment}:${projectName}`;
          const keys = await redis.hkeys(redisKey);
          spinner.stop();

          if (!keys || keys.length === 0) {
            console.log(
              chalk.yellow(`No keys found for ${projectName} (${environment}).`)
            );
            return;
          }

          const selected = await safePrompt(() =>
            checkbox({
              message: "Select keys to remove:",
              choices: keys.map((k) => ({ name: k, value: k })),
              loop: false,
            })
          );

          if (!selected || selected.length === 0) {
            console.log(chalk.gray("No keys selected. Cancelled."));
            return;
          }

          keysToDelete = selected;
        } catch (err) {
          spinner.fail(
            chalk.red(`Failed to fetch keys: ${(err as Error).message}`)
          );
          return;
        }
      } else {
        keysToDelete = [key];
      }

      const redisKey = `${environment}:${projectName}`;
      const spinner = ora(
        `Removing ${keysToDelete.join(
          ", "
        )} from ${projectName} (${environment})...`
      ).start();

      try {
        const result = await redis.hdel(redisKey, ...keysToDelete);
        spinner.stop();

        if (result === 0) {
          console.log(
            chalk.red(
              `✘ No matching keys found for ${projectName} (${environment}).`
            )
          );
        } else {
          console.log(
            chalk.green(
              `✔ Successfully removed ${keysToDelete.join(
                ", "
              )} from ${projectName} (${environment}).`
            )
          );
        }
      } catch (err) {
        spinner.fail(
          chalk.red(
            `Failed to remove ${keysToDelete.join(", ")}: ${
              (err as Error).message
            }`
          )
        );
      }
    });
}
