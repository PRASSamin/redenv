import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../../core/config";
import { safePrompt, sanitizeName } from "../../utils";
import { fetchEnvironments, fetchProjects } from "../../utils/redis";
import { select, confirm, checkbox } from "@inquirer/prompts";
import type { Ora } from "ora";
import { verifyPassword } from "../../core/keys";
import ora from "ora";
import { redis } from "../../core/upstash";

export function dropEnvCommand(program: Command) {
  // --- drop env ---
  program
    .command("env [envs...]")
    .description("Permanently delete one or more environments from a project")
    .option("-p, --project <name>", "Specify the project name")
    .action(action);
}

export const action = async (envs: string[], options: any) => {
  let spinner: Ora | undefined;
  try {
    let projectName =
      sanitizeName(options.project) || (await loadProjectConfig())?.name;

    if (!projectName) {
      const projects = await fetchProjects();
      if (projects.length === 0) {
        console.log(chalk.red("✘ No projects found."));
        return;
      }
      projectName = await safePrompt(() =>
        select({
          message: "Select a project to drop environments from:",
          choices: projects.map((p) => ({ name: p, value: p })),
        })
      );
    }

    let envsToDrop = envs.map(sanitizeName);

    if (envsToDrop.length === 0) {
      const availableEnvs = await fetchEnvironments(projectName);
      if (availableEnvs.length === 0) {
        console.log(
          chalk.yellow(`No environments found for project "${projectName}".`)
        );
        return;
      }
      envsToDrop = await safePrompt(() =>
        checkbox({
          message: "Select one or more environments to drop:",
          choices: availableEnvs.map((e) => ({ name: e, value: e })),
          validate: (c) =>
            c.length > 0 || "Please select at least one environment.",
        })
      );
    }

    if (envsToDrop.length === 0) {
      console.log(chalk.yellow("No environments selected."));
      return;
    }

    console.log(
      chalk.cyan(`\nEnvironments to be deleted from project "${projectName}":`)
    );
    console.log(chalk.yellow(envsToDrop.map((e) => `  - ${e}`).join("\n")));

    const confirmation = await safePrompt(() =>
      confirm({
        message: "This action cannot be undone. Are you sure?",
        default: false,
      })
    );
    if (!confirmation) {
      console.log(chalk.yellow("✘ Drop cancelled."));
      return;
    }

    await verifyPassword(projectName);

    const redisKeys = envsToDrop.map((env) => `${env}:${projectName}`);
    spinner = ora(`Dropping ${envsToDrop.length} environment(s)...`).start();
    await redis.del(...redisKeys);
    spinner.succeed("Successfully dropped environment(s).");
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
        chalk.red(`\n✘ An unexpected error occurred: ${error.message}`)
      );
    }
    process.exit(1);
  }
};
