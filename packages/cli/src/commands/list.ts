import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { redis } from "../core/upstash";
import ora from "ora";
import Table from "cli-table3";
import { checkbox, select } from "@inquirer/prompts";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";
import { unlockProject } from "../core/keys";
import { decrypt } from "../core/crypto";

async function fetchAndDisplayVariables(
  redisKey: string,
  decryptionKey: Buffer
) {
  const [environment, projectName] = redisKey.split(":");
  const spinner = ora(
    `Fetching variables for ${projectName} (${environment})...`
  ).start();
  try {
    const envs = await redis.hgetall<Record<string, string>>(redisKey);
    spinner.stop();

    if (!envs || Object.keys(envs).length === 0) {
      console.log(
        chalk.yellow(
          `No variables found for project ${projectName} (${environment}).`
        )
      );
      return;
    }

    console.log(
      chalk.cyan.bold(`\n📦 Variables for ${projectName} (${environment}):\n`)
    );

    const table = new Table({
      head: [chalk.cyanBright("KEY"), chalk.greenBright("VALUE")],
      colWidths: [28, 50],
      style: { head: [], border: [] },
    });

    const sorted = Object.entries(envs).sort(([a], [b]) => a.localeCompare(b));
    for (const [key, value] of sorted) {
      try {
        const decryptedValue = decrypt(value, decryptionKey);
        table.push([chalk.blue(key), chalk.green(decryptedValue)]);
      } catch (e) {
        table.push([
          chalk.blue(key),
          chalk.yellow(`[Could not decrypt value]`),
        ]);
      }
    }

    console.log(table.toString());
  } catch (err) {
    spinner.fail(
      chalk.red(`Failed to fetch variables: ${(err as Error).message}`)
    );
  }
}

export function listCommand(program: Command) {
  program
    .command("list")
    .description("List all ENV variables")
    .option("--skip-config", "Do not use project configuration")
    .option("-p, --project <name>", "Specify project name")
    .option("-e, --env <env>", "Specify environment")
    .action(async (options) => {
      const projectConfig = loadProjectConfig();
      const projectOption = sanitizeName(options.project);
      const envOption = sanitizeName(options.env);

      // Handle interactive flow when no project is specified
      if (options.skipConfig || !projectConfig) {
        const projects = await fetchProjects();
        const selectedProject = await safePrompt(() =>
          select({
            message: "Select one or more environments to view",
            choices: projects,
            loop: false,
          })
        );
        const pek = await unlockProject(selectedProject as string);

        const envs = await fetchEnvironments(selectedProject as string);

        if (envs.length === 0) {
          console.log(
            chalk.yellow("No environments found across any project.")
          );
          return;
        }

        const selectedEnvs = await checkbox({
          message: "Select one or more environments to view",
          required: true,
          choices: envs.map((p) => ({ name: p, value: p })),
        });

        for (const selection of selectedEnvs) {
          await fetchAndDisplayVariables(
            `${selection}:${selectedProject}`,
            pek
          );
        }
        return;
      }

      // Handle flows where a project is specified or found in config
      const projectName = projectOption || projectConfig?.name;
      if (projectName) {
        const pek = await unlockProject(projectName);
        let environment = envOption || projectConfig?.environment;
        if (!environment) {
          const envs = await fetchEnvironments(projectName, true);
          environment = await safePrompt(() =>
            select({
              message: "Select environment:",
              choices: envs.map((e) => ({ name: e, value: e })),
            })
          );
        }
        const redisKey = `${environment}:${projectName}`;
        await fetchAndDisplayVariables(redisKey, pek);
        return;
      }
    });
}
