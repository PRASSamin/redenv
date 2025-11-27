import chalk from "chalk";
import ora, { type Ora } from "ora";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { sanitizeName, safePrompt, getAuditUser } from "../utils";
import { unlockProject } from "../core/keys";
import { fetchEnvironments } from "../utils/redis";
import { select } from "@inquirer/prompts";
import { writeSecret } from "@redenv/core";
import { redis } from "../core/upstash";
import { multiline } from "@cli-prompts/multiline";

export function addCommand(program: Command) {
  program
    .command("add")
    .argument("<key>", "The ENV key to add")
    .description("Add a new environment variable to your project")
    .option("-p, --project <name>", "Specify the project name")
    .option("-e, --env <env>", "Specify the environment")
    .action(action);
}

export const action = async (key: string, options: any) => {
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
        choices: envs.map((e) => ({ name: e, value: e })),
      })
    );
  }

  const value = await safePrompt(() =>
    multiline({
      prompt: `Enter value for ${key}:`,
      required: true,
      validate(value) {
        if (!value.trim()) return "You must enter something.";
        return true;
      },
    })
  );

  let spinner: Ora | undefined;
  try {
    const pek = options.pek ?? (await unlockProject(projectName));
    spinner = ora(
      `Adding ${chalk.cyan(key)} to ${chalk.yellow(
        projectName
      )} (${environment})...`
    ).start();

    // Prevent accidental overwrites, which the core `writeSecret` does not do.
    const redisKey = `${environment}:${projectName}`;
    const exists = (await redis.hexists(redisKey, key)) > 0;
    if (exists) {
      throw new Error(
        `Key '${key}' already exists. Use 	redenv edit ${key}	 to update it.`
      );
    }

    await writeSecret(
      redis,
      projectName,
      environment,
      key,
      value,
      pek,
      getAuditUser()
    );

    spinner.succeed(
      chalk.greenBright(
        `Added '${key}' → ${chalk.cyan(
          value
        )} in ${projectName} (${environment})`
      )
    );
  } catch (err) {
    const error = err as Error;
    if (spinner && spinner.isSpinning) {
      spinner.fail(chalk.red(error.message));
    }

    if (process.env.REDENV_SHELL_ACTIVE) {
      throw error;
    }

    if (error.name !== "ExitPromptError") {
      console.log(
        chalk.red(`
✘ An unexpected error occurred: ${error.message}`)
      );
    }
    process.exit(1);
  }
};
