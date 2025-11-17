import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects, writeSecret } from "../utils/redis";
import { select, confirm } from "@inquirer/prompts";
import { unlockProject } from "../core/keys";
import { decrypt } from "../core/crypto";
import { redis } from "../core/upstash";
import ora, { Ora } from "ora";
import Table from "cli-table3";

export function rollbackCommand(program: Command) {
  program
    .command("rollback <key>")
    .description("Roll back a secret to a previous version")
    .option("-p, --project <name>", "Specify the project name")
    .option("-e, --env <env>", "Specify the environment")
    .option("-t, --to <version>", "The specific version number to roll back to")
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

      let spinner: Ora | undefined;
      try {
        const pek = await unlockProject(projectName);
        spinner = ora("Fetching history...").start();

        const redisKey = `${environment}:${projectName}`;
        const historyJSON = await redis.hget(redisKey, key);

        if (!historyJSON) {
          spinner.fail(`No secret named "${key}" found in ${environment}.`);
          return;
        }

        const history = 
          typeof historyJSON === "string"
            ? JSON.parse(historyJSON)
            : historyJSON;
            
        if (!Array.isArray(history) || history.length < 2) {
          spinner.fail(`No previous versions found for "${key}" to roll back to.`);
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
            console.log(chalk.yellow("✘ Cannot roll back to the current latest version."));
            return;
          }
          targetVersion = history.find(
            (v) => v.version === targetVersionNumber
          );
          if (!targetVersion) {
            console.log(
              chalk.red(`✘ Version "${options.to}" not found for key "${key}".`)
            );
            return;
          }
        } else {
          const table = new Table({
            head: ["Version", "Timestamp", "User", "Value"],
          });
          // Display only the versions you can roll back to
          for (const version of rollbackableVersions) {
            table.push([
              version.version,
              new Date(version.createdAt).toLocaleString(),
              version.user,
              decrypt(version.value, pek),
            ]);
          }
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
            console.log(chalk.red("✘ Could not identify a target version for rollback."));
            return;
        }
        
        const decryptedValue = decrypt(targetVersion.value, pek);

        const confirmation = await safePrompt(() =>
          confirm({
            message: `Are you sure you want to roll back "${chalk.cyan(
              key
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
        await writeSecret(projectName, environment, key, decryptedValue, pek, {
          isNew: false,
        });
        spinner.succeed(
          `Successfully rolled back "${key}" to version ${targetVersion.version}.`
        );
      } catch (err) {
        if (spinner && spinner.isSpinning)
          spinner.fail(chalk.red((err as Error).message));
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
