import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { redis } from "../core/upstash";
import ora, { type Ora } from "ora";
import { confirm, select, checkbox } from "@inquirer/prompts";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects, scanAll } from "../utils/redis";
import { verifyPassword } from "../core/keys";

export function dropCommand(program: Command) {
  const dropCmd = program
    .command("drop")
    .description("Drop one or more environments or entire projects");

  // --- drop env ---
  dropCmd
    .command("env [envs...]")
    .description("Permanently delete one or more environments from a project")
    .option("-p, --project <name>", "Specify the project name")
    .action(async (envs: string[], options) => {
      let spinner: Ora | undefined;
      try {
        let projectName =
          sanitizeName(options.project) || loadProjectConfig()?.name;

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
              chalk.yellow(
                `No environments found for project "${projectName}".`
              )
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
          chalk.cyan(
            `\nEnvironments to be deleted from project "${projectName}":`
          )
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
        spinner = ora(
          `Dropping ${envsToDrop.length} environment(s)...`
        ).start();
        await redis.del(...redisKeys);
        spinner.succeed("Successfully dropped environment(s).");
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

  // --- drop project ---
  dropCmd
    .command("project [projects...]")
    .description(
      "Permanently delete one or more projects and all of their data"
    )
    .action(async (projects: string[]) => {
      let projectsToDrop = projects.map(sanitizeName);

      if (projectsToDrop.length === 0) {
        const availableProjects = await fetchProjects();
        if (availableProjects.length === 0) {
          console.log(chalk.red("✘ No projects found."));
          return;
        }
        projectsToDrop = await safePrompt(() =>
          checkbox({
            message: "Select one or more projects to drop:",
            choices: availableProjects.map((p) => ({ name: p, value: p })),
            validate: (c) =>
              c.length > 0 || "Please select at least one project.",
          })
        );
      }

      if (projectsToDrop.length === 0) {
        console.log(chalk.yellow("No projects selected."));
        return;
      }

      console.log(
        chalk.cyan.bold("\nProjects selected for complete deletion:")
      );
      console.log(
        chalk.yellow(projectsToDrop.map((p) => `  - ${p}`).join("\n"))
      );

      const confirmation = await safePrompt(() =>
        confirm({
          message:
            "This will permanently delete all selected projects, including all their environments and secrets. This action cannot be undone. Are you sure?",
          default: false,
        })
      );
      if (!confirmation) {
        console.log(chalk.yellow("✘ Drop cancelled."));
        return;
      }

      for (const project of projectsToDrop) {
        let spinner: Ora | undefined;
        console.log(chalk.cyan(`\nProcessing project "${project}"...`));
        try {
          await verifyPassword(project as string);

          spinner = ora(`Finding all data for project "${project}"...`).start();
          const envKeysToDelete = await scanAll(`*:${project}`);
          const metaKey = `meta@${project}`;
          const keysToDelete = [...envKeysToDelete];
          if (await redis.exists(metaKey)) {
            keysToDelete.push(metaKey);
          }
          spinner.succeed(`Found ${keysToDelete.length} Redis keys to delete.`);

          if (keysToDelete.length > 0) {
            const dropSpinner = ora(
              `Deleting ${keysToDelete.length} keys for "${project}"...`
            ).start();
            await redis.del(...keysToDelete);
            dropSpinner.succeed(`Successfully dropped project "${project}".`);
          } else {
            ora().info(
              `No data found for project "${project}", nothing to delete.`
            );
          }
        } catch (err) {
          const error = err as Error;
          if (spinner && spinner.isSpinning) {
            spinner.fail(chalk.red(error.message));
          } else if (error.name !== "ExitPromptError") {
            console.log(
              chalk.red(
                `  ✘ Error processing project "${project}": ${error.message}`
              )
            );
          }
          console.log(chalk.yellow("  Skipping to next project..."));
          continue; // Continue to the next project even if one fails
        }
      }
    });
}
