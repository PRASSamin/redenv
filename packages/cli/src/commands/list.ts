import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { redis } from "../core/upstash";
import ora from "ora";
import Table from "cli-table3";
import { checkbox, select } from "@inquirer/prompts";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";

async function fetchAndDisplayVariables(redisKey: string) {
  const [environment, projectName] = redisKey.split(":");
  const spinner = ora(
    `Fetching variables for ${projectName} (${environment})...`
  ).start();
  try {
    const envs = await redis.hgetall(redisKey);
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
      table.push([chalk.blue(key), chalk.green(value as string)]);
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
    .option("-a, --all", "List variables for all projects")
    .option("-e, --env <env>", "Specify environment")
    .action(async (options) => {
      const projectConfig = loadProjectConfig();
      const projectOption = sanitizeName(options.project);
      const envOption = sanitizeName(options.env);

      if (options.all) {
        try {
          const projects = await fetchProjects(true);

          if (projects.length === 0) {
            console.log(chalk.yellow("No projects found."));
            return;
          }

          for (const project of projects) {
            await fetchAndDisplayVariables(project);
          }
        } catch (err) {
          console.log(
            chalk.red(`✘ Failed to fetch projects: ${(err as Error).message}`)
          );
        }
        return;
      }

      if (options.skipConfig || !projectConfig) {
        if (projectOption) {
          let env = envOption;
          if (!env) {
            const envs = await fetchEnvironments(projectOption, true);
            env = await safePrompt(() =>
              select({
                message: "Select environment:",
                choices: envs,
              })
            );
          }
          const redisKey = `${env}:${projectOption}`;
          await fetchAndDisplayVariables(redisKey);
        } else {
          const projects = await fetchProjects(true);

          if (projects.length === 0) {
            console.log(chalk.yellow("No projects found."));
            return;
          }

          const redisKey = await checkbox({
            message: "Select a project",
            required: true,
            choices: projects.map((p) => ({ name: p, value: p })),
          });

          for (const key of redisKey) {
            await fetchAndDisplayVariables(key);
          }
        }
        return;
      }

      const projectName = projectOption || projectConfig.name;
      const environment = envOption || projectConfig.environment;
      const redisKey = `${environment}:${projectName}`;
      await fetchAndDisplayVariables(redisKey);
    });
}

