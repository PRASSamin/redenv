import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../../core/config";
import { safePrompt, sanitizeName } from "../../utils";
import { fetchProjects } from "../../utils/redis";
import { input, select } from "@inquirer/prompts";
import { unlockProject } from "../../core/keys";
import ora from "ora";
import { redis } from "../../core/upstash";

export function historyLimitCommand(program: Command) {
  program
    .command("limit [value]")
    .description("Change the number of history entries kept for a project")
    .option("-p, --project <name>", "Specify the project name")
    .action(action);
}

export const action = async (value: string, options: any) => {
  let projectName = sanitizeName(options.project) || (await loadProjectConfig())?.name;

  if (!projectName) {
    const projects = await fetchProjects();
    if (projects.length === 0) {
      console.log(chalk.red("✘ No projects found."));
      return;
    }
    projectName = await safePrompt(() =>
      select({
        message: "Select a project:",
        choices: projects.map((p) => ({ name: p, value: p })),
      })
    );
  }

  let limit: number | null = value ? parseInt(value, 10) : null;

  if (limit === null) {
    const rawLimit = await safePrompt(() =>
      input({
        message: "Enter the new history limit. Use 0 for unlimited:",
        validate: (val) => {
          const num = Number(val);
          return (
            (!isNaN(num) && num >= 0) || "Please enter a non-negative number."
          );
        },
      })
    );
    limit = Number(rawLimit);
  }

  if (isNaN(limit) || limit < 0) {
    console.log(chalk.red("✘ History limit must be a non-negative number."));
    return;
  }

  const spinner = ora(
    `Setting history limit for "${projectName}" to ${limit}...`
  ).start();
  try {
    // We must unlock the project to prove ownership before changing settings
    await (options.pek ?? unlockProject(projectName as string));

    const metaKey = `meta@${projectName}`;
    await redis.hset(metaKey, { historyLimit: limit });
    spinner.succeed(
      `History limit for "${projectName}" is now set to ${limit}.`
    );
  } catch (err) {
    const error = err as Error;
    if (spinner.isSpinning) spinner.fail(chalk.red((err as Error).message));
    
    if (process.env.REDENV_SHELL_ACTIVE) {
      throw error;
    }

    if ((err as Error).name !== "ExitPromptError") {
      console.log(
        chalk.red(`\n✘ An unexpected error occurred: ${(err as Error).message}`)
      );
    }
    process.exit(1);
  }
};
