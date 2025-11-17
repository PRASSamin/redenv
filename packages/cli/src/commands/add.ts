import chalk from "chalk";
import ora from "ora";
import { redis } from "../core/upstash";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { sanitizeName, safePrompt } from "../utils";
import { unlockProject } from "../core/keys";
import { encrypt } from "../core/crypto";
import { fetchEnvironments } from "../utils/redis";
import { select } from "@inquirer/prompts";

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

      const projectName =
        sanitizeName(options.project) || projectConfig?.name!;
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

      try {
        // Unlock project and get encryption key
        const pek = await unlockProject(projectName);

        const spinner = ora(
          `Adding ${chalk.cyan(key)} to ${chalk.yellow(
            projectName
          )} (${environment})...`
        ).start();

        const redisKey = `${environment}:${projectName}`;
        const exists = await redis.hexists(redisKey, key);
        if (exists) {
          spinner.fail(
            chalk.yellow(
              `Key '${key}' already exists in ${projectName} (${environment}).\n\nUse 'redenv edit ${key} <newValue>' to update it.`
            )
          );
          return;
        }

        // Encrypt the value before storing
        const encryptedValue = encrypt(value, pek);

        await redis.hset(redisKey, { [key]: encryptedValue });
        spinner.succeed(
          chalk.greenBright(
            `Added '${key}' → ${chalk.cyan(
              value
            )} in ${projectName} (${environment})`
          )
        );
      } catch (err) {
        // The spinner may not be initialized if unlockProject fails, so check for it.
        if (ora().spinner) {
          ora().fail(
            chalk.red(`Failed to add '${key}': ${(err as Error).message}`)
          );
        } else {
          // unlockProject already logs its own errors, so we might not need to log again.
        }
      }
    });
}
