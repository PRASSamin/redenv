import chalk from "chalk";
import ora, { type Ora } from "ora";
import { redis } from "../core/upstash";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { select, checkbox, confirm } from "@inquirer/prompts";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments } from "../utils/redis";
import { verifyPassword } from "../core/keys";

export function removeCommand(program: Command) {
  program
    .command("remove")
    .argument("[key]", "ENV key to remove")
    .description("Remove one or more keys from the project in Upstash")
    .option("-p, --project <name>", "Specify project name")
    .option("-e, --env <env>", "Specify environment")
    .action(async (key, options) => {
      let spinner: Ora | undefined;
      try {
        const projectConfig = loadProjectConfig();
        if (!projectConfig && !options.project) {
          console.log(
            chalk.red(
              "✘ No project registered. Use `redenv register <name>` or pass `--project <name>`."
            )
          );
          return;
        }

        const projectName =
          sanitizeName(options.project) || projectConfig?.name;
        let environment =
          sanitizeName(options.env) || projectConfig?.environment;

        if (!environment) {
          const envs = await fetchEnvironments(projectName, true);
          environment = await safePrompt(() =>
            select({
              message: "Select environment:",
              choices: envs.map((e) => ({ name: e, value: e })),
            })
          );
        }

        // Determine which keys to delete
        let keysToDelete: string[] = [];

        if (!key) {
          spinner = ora(
            `Fetching all keys from ${projectName} (${environment})...`
          ).start();

          const redisKey = `${environment}:${projectName}`;
          const keys = await redis.hkeys(redisKey);
          spinner.stop();

          if (!keys || keys.length === 0) {
            console.log(
              chalk.yellow(
                `No keys found for ${projectName} (${environment}).`
              )
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
        } else {
          keysToDelete = [key];
        }

        const confirmation = await safePrompt(() =>
          confirm({
            message: `This will permanently remove ${keysToDelete.length} key(s) from the "${environment}" environment. Are you sure?`,
            default: false,
          })
        );

        if (!confirmation) {
          console.log(chalk.yellow("✘ Removal cancelled."));
          return;
        }

        // Secure: Verify ownership before deleting
        await verifyPassword(projectName as string);

        const redisKey = `${environment}:${projectName}`;
        spinner = ora(
          `Removing ${keysToDelete.length} key(s) from ${projectName} (${environment})...`
        ).start();

        const result = await redis.hdel(redisKey, ...keysToDelete);

        if (result > 0) {
          spinner.succeed(
            chalk.green(
              `✔ Successfully removed ${result} key(s) from ${projectName} (${environment}).`
            )
          );
        } else {
          spinner.warn(
            chalk.yellow(
              `No matching keys found to remove in ${projectName} (${environment}).`
            )
          );
        }
      } catch (err) {
        const error = err as Error;
        if (spinner && spinner.isSpinning) {
          spinner.fail(chalk.red(error.message));
        } else if (error.name !== "ExitPromptError") {
          console.log(
            chalk.red(`\n✘ An unexpected error occurred: ${error.message}`)
          );
        }
        process.exit(1);
      }
    });
}
