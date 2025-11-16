import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { redis } from "../core/upstash";
import ora from "ora";
import { confirm, select } from "@inquirer/prompts";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects, scanAll } from "../utils/redis";

export function dropCommand(program: Command) {
  const dropCmd = program
    .command("drop")
    .description("Drop an environment or an entire project");

  // drop env
  dropCmd
    .command("env")
    .argument("[env]", "The environment to drop")
    .option("-p, --project <name>", "Specify the project name")
    .description("Permanently delete an environment from a project")
    .action(async (env, options) => {
      let projectName =
        sanitizeName(options.project) || loadProjectConfig()?.name;
      let envToDrop = sanitizeName(env);

      if (!projectName) {
        const projects = await fetchProjects();
        if (!projects.length) {
          console.log(chalk.red("✘ No projects found."));
          return;
        }
        projectName = await safePrompt(() =>
          select({ message: "Select project:", choices: projects })
        );
      }
      const envs = await fetchEnvironments(projectName);
      if (!envs.length) {
        console.log(
          chalk.red(`✘ No environments found for project "${projectName}".`)
        );
        return;
      }

      if (!envToDrop) {
        envToDrop = await safePrompt(() =>
          select({ message: "Select environment to drop:", choices: envs })
        );
      }

      if (envToDrop && !envs.includes(envToDrop)) {
        console.log(
          chalk.red(
            `✘ Environment "${envToDrop}" does not exist for project "${projectName}".`
          )
        );
        return;
      }

      const confirmation = await safePrompt(() =>
        confirm({
          message: `This will permanently delete the "${chalk.yellow(
            envToDrop
          )}" environment for project "${chalk.cyan(
            projectName
          )}".\n  This action cannot be undone. Are you sure?`,
          default: false,
        })
      );

      if (!confirmation) {
        console.log(chalk.yellow("✘ Drop cancelled."));
        return;
      }

      const redisKey = `${envToDrop}:${projectName}`;
      const spinner = ora(`Dropping environment "${envToDrop}"...`).start();
      try {
        await redis.del(redisKey);
        spinner.succeed(
          chalk.green(
            `✔ Successfully dropped environment "${envToDrop}" from project "${projectName}".`
          )
        );
      } catch (err) {
        spinner.fail(
          chalk.red(`✘ Failed to drop environment: ${(err as Error).message}`)
        );
      }
    });

  // drop project
  dropCmd
    .command("project")
    .argument("[project]", "The project to drop")
    .description("Permanently delete a project and all of its environments")
    .action(async (project, options) => {
      let projectToDrop = sanitizeName(project);

      if (!projectToDrop) {
        const projects = await fetchProjects();
        if (!projects.length) {
          console.log(chalk.red("✘ No projects found."));
          return;
        }
        projectToDrop = await safePrompt(() =>
          select({ message: "Select project to drop:", choices: projects })
        );
      }

      const spinner = ora(
        `Fetching environments for project "${projectToDrop}"...`
      ).start();
      const keysToDelete = await scanAll(`*:${projectToDrop}`);
      spinner.stop();

      if (!keysToDelete.length) {
        console.log(
          chalk.red(
            `✘ Project "${projectToDrop}" not found or has no environments.`
          )
        );
        return;
      }

      const envsToDelete = keysToDelete.map((k) => k.split(":")[0]);

      const confirmation = await safePrompt(() =>
        confirm({
          message: `This will permanently delete the project "${chalk.cyan(
            projectToDrop
          )}" and all of its ${
            keysToDelete.length
          } environment(s):\n  ${chalk.yellow(
            envsToDelete.join(", ")
          )}\n\n  This action cannot be undone. Are you sure?`,
          default: false,
        })
      );

      if (!confirmation) {
        console.log(chalk.yellow("✘ Drop cancelled."));
        return;
      }

      const dropSpinner = ora(`Dropping project "${projectToDrop}"...`).start();
      try {
        // Use a pipeline for atomic deletion
        const p = redis.pipeline();
        for (const key of keysToDelete) {
          p.del(key);
        }
        await p.exec();

        dropSpinner.succeed(
          chalk.green(
            `✔ Successfully dropped project "${projectToDrop}" and its ${keysToDelete.length} environment(s).`
          )
        );
      } catch (err) {
        dropSpinner.fail(
          chalk.red(`✘ Failed to drop project: ${(err as Error).message}`)
        );
      }
    });
}
