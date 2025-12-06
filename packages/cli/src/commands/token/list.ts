import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../../core/config";
import { safePrompt, sanitizeName } from "../../utils";
import { fetchProjects } from "../../utils/redis";
import { select } from "@inquirer/prompts";
import { redis } from "../../core/upstash";
import ora from "ora";
import Table from "cli-table3";
import { parseServiceTokens } from ".";

export function listTokenCommand(program: Command) {
  program
    .command("list")
    .argument("[project]", "The project to list tokens for")
    .description("List all active Service Tokens for a project")
    .action(action);
}

export const action = async (project: string, options: any) => {
  let projectName =
    sanitizeName(project) || (await loadProjectConfig())?.name || options.project;

  if (!projectName) {
    const projects = await fetchProjects();
    if (projects.length === 0) {
      console.log(chalk.red("✘ No projects found."));
      return;
    }
    projectName = await safePrompt(() =>
      select({
        message: "Select project to list tokens for:",
        choices: projects.map((p) => ({ name: p, value: p })),
      })
    );
  }

  const spinner = ora("Fetching tokens...").start();
  try {
    const metaKey = `meta@${projectName}`;
    const metadata = await redis.hgetall<Record<string, any>>(metaKey);

    const serviceTokens = parseServiceTokens(metadata);
    const tokenIds = Object.keys(serviceTokens);

    if (tokenIds.length === 0) {
      spinner.info(`No Service Tokens found for project "${projectName}".`);
      return;
    }
    spinner.succeed(
      `Found ${tokenIds.length} Service Token(s) for project "${projectName}".`
    );

    const table = new Table({
      head: ["Name", "Description", "Token ID", "Created At"],
      colWidths: [20, 30, 22, 30],
    });

    tokenIds.forEach((id) => {
      const token = serviceTokens[id];
      table.push([
        token.name,
        token.description,
        id,
        new Date(token.createdAt).toLocaleString(),
      ]);
    });
    console.log(table.toString());
  } catch (err) {
    spinner.fail(chalk.red((err as Error).message));
    if (process.env.REDENV_SHELL_ACTIVE) {
      throw err;
    }
    process.exit(1);
  }
};
