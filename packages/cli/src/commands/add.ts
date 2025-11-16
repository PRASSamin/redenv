import chalk from "chalk";
import ora from "ora";
import { redis } from "../core/upstash";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { sanitizeName } from "../utils";

export function addCommand(program: Command) {
  program
    .command("add")
    .argument("<key>", "The ENV key to add")
    .argument("<value>", "The value to assign to the ENV key")
    .description("Add a new environment variable to your project")
    .option("-p, --project <name>", "Specify the project name")
    .option("-e, --env <env>", "Specify the environment")
    .action(async (key, value, options) => {
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
      const environment =
        sanitizeName(options.env) || projectConfig?.environment || "dev";
      const redisKey = `${environment}:${projectName}`;

      const spinner = ora(
        `Adding ${chalk.cyan(key)} to ${chalk.yellow(
          projectName
        )} (${environment})...`
      ).start();

      try {
        const exists = await redis.hexists(redisKey, key);
        if (exists) {
          spinner.fail(
            chalk.yellow(
              `Key '${key}' already exists in ${projectName} (${environment}).\n\nUse 'redenv edit ${key} <newValue>' to update it.`
            )
          );
          return;
        }

        await redis.hset(redisKey, { [key]: value });
        spinner.succeed(
          chalk.greenBright(
            `Added '${key}' → ${chalk.cyan(
              value
            )} in ${projectName} (${environment})`
          )
        );
      } catch (err) {
        spinner.fail(
          chalk.red(`Failed to add '${key}': ${(err as Error).message}`)
        );
      }
    });
}
