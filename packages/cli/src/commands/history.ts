import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";
import { select, input } from "@inquirer/prompts";
import { unlockProject } from "../core/keys";
import { decrypt } from "@redenv/core";
import { redis } from "../core/upstash";
import ora from "ora";
import Table from "cli-table3";

export function historyCommand(program: Command) {
  const historyCmd = program
    .command("history")
    .description(
      "View the version history of a secret or manage history settings"
    );

  historyCmd
    .command("view [key]")
    .description("View the version history of a specific secret")
    .option("-p, --project <name>", "Specify the project name")
    .option("-e, --env <env>", "Specify the environment")
    .action(async (key, options) => {
      let projectName =
        sanitizeName(options.project) || loadProjectConfig()?.name;
      let environment =
        sanitizeName(options.env) || loadProjectConfig()?.environment;

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

      if (!environment) {
        const envs = await fetchEnvironments(projectName);
        if (envs.length === 0) {
          console.log(
            chalk.yellow(`No environments found for project "${projectName}".`)
          );
          return;
        }
        environment = await safePrompt(() =>
          select({
            message: "Select an environment:",
            choices: envs.map((e) => ({ name: e, value: e })),
          })
        );
      }

      const spinner = ora("Fetching history...").start();
      try {
        const pek = await unlockProject(projectName);
        const redisKey = `${environment}:${projectName}`;

        let targetKey = key;
        if (!targetKey) {
          spinner.text = "Fetching keys for selection...";
          const keysInEnv = await redis.hkeys(redisKey);
          spinner.stop();
          if (keysInEnv.length === 0) {
            console.log(
              chalk.yellow(`No secrets found in environment "${environment}".`)
            );
            return;
          }
          targetKey = await safePrompt(() =>
            select({
              message: "Select a secret to view its history:",
              loop: false,
              choices: keysInEnv.map((k) => ({ name: k, value: k })),
            })
          );
          spinner.start("Fetching history...");
        }

        const history = (await redis.hget(redisKey, targetKey)) as any[];

        if (!history) {
          spinner.fail(
            `No secret named "${targetKey}" found in ${environment}.`
          );
          return;
        }

        if (!Array.isArray(history) || history.length === 0) {
          spinner.fail(`No history found for "${targetKey}".`);
          return;
        }

        spinner.succeed(
          `Found ${history.length} version(s) for "${targetKey}".`
        );

        const table = new Table({
          head: ["Version", "Timestamp", "User", "Value"],
          colWidths: [10, 30, 25, 40],
        });

        const decryptionPromises = history.map(async (version) => {
          try {
            const decryptedValue = await decrypt(version.value, pek);
            return [
              version.version,
              new Date(version.createdAt).toLocaleString(),
              version.user,
              decryptedValue,
            ];
          } catch {
            return [
              version.version,
              new Date(version.createdAt).toLocaleString(),
              version.user,
              chalk.yellow("[Could not decrypt]"),
            ];
          }
        });

        const decryptedRows = await Promise.all(decryptionPromises);
        decryptedRows.forEach((row) => table.push(row));

        console.log(table.toString());
      } catch (err) {
        if (spinner.isSpinning) spinner.fail(chalk.red((err as Error).message));
        else if ((err as Error).name !== "ExitPromptError") {
          console.log(
            chalk.red(
              `\n✘ An unexpected error occurred: ${(err as Error).message}`
            )
          );
        }
        process.exit(1);
      }
    });

  historyCmd
    .command("limit [value]")
    .description("Change the number of history entries kept for a project")
    .option("-p, --project <name>", "Specify the project name")
    .action(async (value, options) => {
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
                (!isNaN(num) && num >= 0) ||
                "Please enter a non-negative number."
              );
            },
          })
        );
        limit = Number(rawLimit);
      }

      if (isNaN(limit) || limit < 0) {
        console.log(
          chalk.red("✘ History limit must be a non-negative number.")
        );
        return;
      }

      const spinner = ora(
        `Setting history limit for "${projectName}" to ${limit}...`
      ).start();
      try {
        // We must unlock the project to prove ownership before changing settings
        await unlockProject(projectName);

        const metaKey = `meta@${projectName}`;
        await redis.hset(metaKey, { historyLimit: limit });
        spinner.succeed(
          `History limit for "${projectName}" is now set to ${limit}.`
        );
      } catch (err) {
        if (spinner.isSpinning) spinner.fail(chalk.red((err as Error).message));
        else if ((err as Error).name !== "ExitPromptError") {
          console.log(
            chalk.red(
              `\n✘ An unexpected error occurred: ${(err as Error).message}`
            )
          );
        }
        process.exit(1);
      }
    });
}
