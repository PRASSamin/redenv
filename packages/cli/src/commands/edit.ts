import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { redis } from "../core/upstash";
import { loadProjectConfig } from "../core/config";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";
import { select } from "@inquirer/prompts";
import { multiline } from "@cli-prompts/multiline";

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

      let projectName = sanitizeName(options.project) || projectConfig?.name;
      let environment = sanitizeName(options.env) || projectConfig?.environment;
      if (!environment) {
        const envs = (await fetchEnvironments(projectName || "", true)) || [];
        environment = await safePrompt(() =>
          select({
            message: "Select environment:",
            loop: false,
            choices: envs,
          })
        );
      }

      if (!projectName) {
        const projects = await fetchProjects();

        if (projects.length === 0) {
          console.log(chalk.red("✘ No projects found in Redis."));
          return;
        }

        projectName = await safePrompt(() =>
          select({
            message: "Select project:",
            choices: projects,
            loop: false,
          })
        );
      }

      const redisKey = `${environment}:${projectName}`;

      try {
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

        await redis.hset(redisKey, { [key]: newValue });
        spinner.succeed(
          chalk.greenBright(
            `Updated '${key}' → ${chalk.cyan(
              newValue
            )} in ${projectName} (${environment})`
          )
        );
      } catch (err) {
        console.log(
          chalk.red(`Failed to update '${key}': ${(err as Error).message}`)
        );
      }
    });
}
