import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../../core/config";
import {
  nameValidator,
  safePrompt,
  sanitizeName,
  writeProjectConfig,
  ContextSwitchRequest,
} from "../../utils";
import { fetchProjects } from "../../utils/redis";
import { select, input } from "@inquirer/prompts";

export function switchProjectCommand(program: Command) {
  // -------------------------------
  // Switch project
  // -------------------------------
  program
    .command("project")
    .description("Switch to a different project")
    .option("-p, --project <name>", "Specify project name")
    .action(action);
}

export const action = async (options: any) => {
  const projectConfig = loadProjectConfig() || {
    name: "",
    environment: "development",
    createdAt: new Date().toISOString(),
  };

  let project = !process.env.REDENV_SHELL_ACTIVE
    ? sanitizeName(options.project)
    : undefined;

  if (!project) {
    const projects: string[] = await fetchProjects();

    project = await safePrompt(() =>
      select({
        message: "Select project:",
        choices: [
          ...projects.map((p) => ({ name: p, value: p })),
          { name: "New project", value: "New project" },
        ],
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

  if (process.env.REDENV_SHELL_ACTIVE) {
    throw new ContextSwitchRequest("Switching project", {
      newProject: project,
    });
  }

  projectConfig.name = project;
  writeProjectConfig(projectConfig);
  console.log(
    chalk.green(
      `✔ Switched to project '${project}'. Current environment: '${projectConfig.environment}'.`
    )
  );
};
