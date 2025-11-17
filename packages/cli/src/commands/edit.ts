import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { redis } from "../core/upstash";
import { loadProjectConfig } from "../core/config";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments } from "../utils/redis";
import { select } from "@inquirer/prompts";
import { multiline } from "@cli-prompts/multiline";
import { unlockProject } from "../core/keys";
import { encrypt } from "../core/crypto";

export function editCommand(program: Command) {
  program
    .command("edit")
    .argument("<key>", "The ENV key to modify")
    .description("Update an existing environment variable’s value")
    .option("-p, --project <name>", "Specify the project name")
    .option("-e, --env <env>", "Specify the environment")
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

      const projectName = 
        sanitizeName(options.project) || projectConfig?.name!;
      let environment = 
        sanitizeName(options.env) || projectConfig?.environment;

      if (!environment) {
        const envs = (await fetchEnvironments(projectName, true)) || [];
        environment = await safePrompt(() =>
          select({
            message: "Select environment:",
            loop: false,
            choices: envs.map((e) => ({ name: e, value: e })),
          })
        );
      }

      try {
        const pek = await unlockProject(projectName);

        const redisKey = `${environment}:${projectName}`;

        const exists = await redis.hexists(redisKey, key);
        if (!exists) {
          console.log(
            chalk.yellow(
              `Key '${key}' doesn’t exist in ${projectName} (${environment}).\nUse 'redenv add ${key} <value>' to create it.`
            )
          );
          return;
        }

        const newValue = await safePrompt(() =>
          multiline({
            prompt: "Enter new value:",
            required: true,
            validate(value) {
              if (!value.trim()) return "You must enter something.";
              return true;
            },
          })
        );

        const spinner = ora(
          `Updating ${chalk.cyan(key)} in ${chalk.yellow(
            projectName
          )} (${environment})...`
        ).start();

        const encryptedValue = encrypt(newValue, pek);
        await redis.hset(redisKey, { [key]: encryptedValue });

        spinner.succeed(
          chalk.greenBright(
            `Updated '${key}' → ${chalk.cyan(
              newValue
            )} in ${projectName} (${environment})`
          )
        );
      } catch (err) {
        // Errors from unlockProject are handled, so this will catch other issues.
        console.log(
          chalk.red(`\n✘ Failed to update '${key}': ${(err as Error).message}`)
        );
      }
    });
}
