import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig, PROJECT_CONFIG_PATH } from "../../core/config";
import {
  nameValidator,
  safePrompt,
  sanitizeName,
  ContextSwitchRequest,
} from "../../utils";
import { fetchEnvironments } from "../../utils/redis";
import { select, input } from "@inquirer/prompts";
import fs from "fs";

export function switchEnvCommand(program: Command) {
  // -------------------------------
  // Switch environment
  // -------------------------------
  program
    .command("env")
    .description("Switch between different environments")
    .option("-e, --env <env>", "Specify environment")
    .action(action);
}

export const action = async (options: any) => {
  const projectConfig = loadProjectConfig() || options;
  if (!projectConfig) {
    console.log(
      chalk.red("✘ No project registered. Use `redenv register <name>` first.")
    );
    return;
  }

  const envs: string[] = await fetchEnvironments(
    options.project || projectConfig.name
  );
  let environment = !process.env.REDENV_SHELL_ACTIVE
    ? sanitizeName(options.env)
    : undefined;

  if (!environment) {
    environment = await safePrompt(() =>
      select({
        message: "Select environment:",
        choices: [
          ...envs.map((e) => ({ name: e, value: e })),
          { name: "New environment", value: "New environment" },
        ],
      })
    );
    if (environment === "New environment") {
      environment = await safePrompt(() =>
        input({
          message: "Enter environment name:",
          validate: nameValidator,
        })
      );
    }
  }

  if (process.env.REDENV_SHELL_ACTIVE) {
    throw new ContextSwitchRequest("Switching environment", {
      newEnv: environment,
    });
  }

  projectConfig.environment = environment;
  fs.writeFileSync(PROJECT_CONFIG_PATH, JSON.stringify(projectConfig, null, 2));
  console.log(chalk.green(`✔ Switched to '${environment}' environment.`));
};
