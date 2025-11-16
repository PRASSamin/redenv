import chalk from "chalk";
import fs from "fs";
import { Command } from "commander";
import { loadProjectConfig, PROJECT_CONFIG_PATH } from "../core/config";
import { input, select } from "@inquirer/prompts";
import { nameValidator, safePrompt, sanitizeName, writeProjectConfig } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";

export function switchCommand(program: Command) {
  const switchCmd = program
    .command("switch")
    .description(
      "Switch between different environments or switch to a different project"
    );

  // -------------------------------
  // Switch environment
  // -------------------------------
  switchCmd
    .command("env")
    .description("Switch between different environments")
    .option("-e, --env <env>", "Specify environment")
    .action(async (options) => {
      const projectConfig = loadProjectConfig();
      if (!projectConfig) {
        console.log(
          chalk.red(
            "✘ No project registered. Use `redenv register <name>` first."
          )
        );
        return;
      }

      const envs: string[] = await fetchEnvironments(projectConfig.name);
      let environment = sanitizeName(options.env);

      if (!environment) {
        environment = await safePrompt(() =>
          select({
            message: "Select environment:",
            choices: [...envs, "New environment"],
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

      projectConfig.environment = environment;
      fs.writeFileSync(
        PROJECT_CONFIG_PATH,
        JSON.stringify(projectConfig, null, 2)
      );
      console.log(chalk.green(`✔ Switched to '${environment}' environment.`));
    });

  // -------------------------------
  // Switch project
  // -------------------------------
  switchCmd
    .command("project")
    .description("Switch to a different project")
    .option("-p, --project <name>", "Specify project name")
    .action(async (options) => {
      const projectConfig = loadProjectConfig() || {
        name: "",
        environment: "development",
        productionEnvironment: "production",
        createdAt: new Date().toISOString(),
      };

      let project = sanitizeName(options.project);

      if (!project) {
        const projects: string[] = await fetchProjects();

        project = await safePrompt(() =>
          select({
            message: "Select project:",
            choices: [...projects, "New project"],
          })
        );
        if (project === "New project") {
          project = await safePrompt(() =>
            input({
              message: "Enter project name:",
              validate: nameValidator,
            })
          );
        }
      }

      projectConfig.name = project;
      writeProjectConfig(projectConfig);
      console.log(
        chalk.green(
          `✔ Switched to project '${project}'. Current environment: '${projectConfig.environment}'.`
        )
      );
    });
}
