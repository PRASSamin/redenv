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
import { decrypt } from "../core/crypto";

export function viewCommand(program: Command) {
  program
    .command("view")
    .argument("<key>", "ENV key to view")
    .description("View the value of a specific ENV variable")
    .option("-p, --project <name>", "Specify the project name")
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

      try {
        // Unlock the project first, before any spinners start.
        const pek = await unlockProject(projectName);

        const spinner = ora(
          `Fetching value for ${chalk.cyan(key)} in ${chalk.yellow(
            projectName
          )}...`
        ).start();

        const redisKey = `${environment}:${projectName}`;
        const history = await redis.hget(redisKey, key);

        if (history === null || history === undefined) {
          spinner.fail(
            chalk.red(
              `Key '${key}' not found in ${projectName} (${environment}).`
            )
          );
          return;
        }

        spinner.succeed(
          chalk.greenBright(`Found key in ${projectName} (${environment})`)
        );

        let decryptedValue;
        try {
          if (!Array.isArray(history) || history.length === 0) {
            throw new Error("History format is invalid.");
          }
          const latestVersion = history[0];
          decryptedValue = decrypt(latestVersion.value, pek);
        } catch {
          console.log(
            chalk.yellow(
              `\n⚠️  Could not decrypt the value for '${key}'. It might be corrupted or the project key is incorrect.`
            )
          );
          // In case of error, show the raw JSON for debugging
          decryptedValue = history;
        }

        const table = new Table({
          head: [chalk.blueBright("KEY"), chalk.greenBright("VALUE")],
          colWidths: [30, 80],
          style: { head: [], border: [] },
        });

        table.push([chalk.cyan(key), chalk.whiteBright(decryptedValue)]);
        console.log(table.toString());
      } catch (err) {
        // Errors from unlockProject are handled within the function, so this will catch other errors.
        console.log(
          chalk.red(
            `\n✘ An unexpected error occurred: ${(err as Error).message}`
          )
        );
      }
    });
}
