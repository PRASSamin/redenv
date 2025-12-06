import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { getAuditUser, safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";
import { select, confirm } from "@inquirer/prompts";
import { unlockProject } from "../core/keys";
import { decrypt, writeSecret } from "@redenv/core";
import { redis } from "../core/upstash";
import ora, { type Ora } from "ora";
import Table from "cli-table3";

export function rollbackCommand(program: Command) {
  program
    .command("rollback [key]")
    .description("Roll back a secret to a previous version")
    .option("-p, --project <name>", "Specify the project name")
    .option("-e, --env <env>", "Specify the environment")
    .option("-t, --to <version>", "The specific version number to roll back to")
    .action(action);
}

export const action = async (key: string, options: any) => {
      const projectConfig = await loadProjectConfig();
      let projectName =
        sanitizeName(options.project) || projectConfig?.name;
      let environment =
        sanitizeName(options.env) || projectConfig?.environment;

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

      let spinner: Ora | undefined;
      try {
        const pek = options.pek ?? (await unlockProject(projectName as string));
        const redisKey = `${environment}:${projectName}`;
        let targetKey = key;

        if (!targetKey) {
          spinner = ora("Fetching keys...").start();
          const envData = await redis.hgetall<Record<string, any>>(redisKey);
          spinner.stop();

          if (!envData || Object.keys(envData).length === 0) {
            console.log(
              chalk.yellow(`No secrets found in environment "${environment}".`)
            );
            return;
          }

          const choices = Object.entries(envData).map(([key, history]) => {
            const versionCount = Array.isArray(history) ? history.length : 0;
            const canRollback = versionCount >= 2;
            return canRollback
              ? {
                  name: `${key} ${chalk.gray(`(${versionCount} versions)`)}`,
                  value: key,
                }
              : null;
          });

          const filteredChoices = choices.filter((choice) => choice !== null);

          if (filteredChoices.length === 0) {
            console.log(
              chalk.yellow(
                "No secrets with multiple versions available for rollback."
              )
            );
            return;
          }

          targetKey = await safePrompt(() =>
            select({
              message: "Select a secret to roll back:",
              choices: filteredChoices,
            })
          );
        }

        spinner = ora("Fetching history...").start();
        const historyJSON = await redis.hget(redisKey, targetKey);

        if (!historyJSON) {
          spinner.fail(
            `No secret named "${targetKey}" found in ${environment}.`
          );
          return;
        }

        const history =
          typeof historyJSON === "string"
            ? JSON.parse(historyJSON)
            : historyJSON;

        if (!Array.isArray(history) || history.length < 2) {
          spinner.fail(
            `No previous versions found for "${targetKey}" to roll back to.`
          );
          return;
        }
        spinner.succeed("History fetched.");

        let targetVersion: any;
        const targetVersionNumber = options.to
          ? parseInt(options.to, 10)
          : null;

        const rollbackableVersions = history.slice(1);

        if (targetVersionNumber) {
          if (targetVersionNumber === history[0].version) {
            console.log(
              chalk.yellow("✘ Cannot roll back to the current latest version.")
            );
            return;
          }
          targetVersion = history.find(
            (v) => v.version === targetVersionNumber
          );
          if (!targetVersion) {
            console.log(
              chalk.red(
                `✘ Version "${options.to}" not found for key "${targetKey}".`
              )
            );
            return;
          }
        } else {
          const table = new Table({
            head: ["Version", "Timestamp", "User", "Value"],
          });

          const decryptionPromises = rollbackableVersions.map(
            async (version) => {
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
            }
          );
          const decryptedRows = await Promise.all(decryptionPromises);
          decryptedRows.forEach((row) => table.push(row as any));

          console.log(chalk.cyan("\nAvailable rollback versions:"));
          console.log(table.toString());

          const choice = await safePrompt(() =>
            select({
              message: "Select a version to roll back to:",
              choices: rollbackableVersions.map((v) => ({
                name: `Version ${v.version} (by ${v.user})`,
                value: v.version,
              })),
            })
          );
          targetVersion = history.find((v) => v.version === choice);
        }

        if (!targetVersion) {
          console.log(
            chalk.red("✘ Could not identify a target version for rollback.")
          );
          return;
        }

        const decryptedValue = await decrypt(targetVersion.value, pek);

        const confirmation = await safePrompt(() =>
          confirm({
            message: `Are you sure you want to roll back "${chalk.cyan(
              targetKey
            )}" to version ${chalk.yellow(
              targetVersion.version
            )}?\n  This will create a new version with the value: "${chalk.green(
              decryptedValue
            )}"`,
            default: false,
          })
        );

        if (!confirmation) {
          console.log(chalk.yellow("✘ Rollback cancelled."));
          return;
        }

        spinner.start("Rolling back secret...");
        await writeSecret(
          redis,
          projectName,
          environment,
          targetKey,
          decryptedValue,
          pek,
          getAuditUser()
        );
        spinner.succeed(
          `Successfully rolled back "${targetKey}" by creating a new version with the content of version ${targetVersion.version}.`
        );
      } catch (err) {
        const error = err as Error;
        if (spinner && spinner.isSpinning)
          spinner.fail(chalk.red((err as Error).message));
        
        if (process.env.REDENV_SHELL_ACTIVE) {
          throw error;
        }

        if ((err as Error).name !== "ExitPromptError") {
          console.log(
            chalk.red(
              `\n✘ An unexpected error occurred: ${(err as Error).message}`
            )
          );
        }
        process.exit(1);
      }
    }