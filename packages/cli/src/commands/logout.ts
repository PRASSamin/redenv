import chalk from "chalk";
import { Command } from "commander";
import { safePrompt, sanitizeName } from "../utils";
import { fetchProjects } from "../utils/redis";
import { checkbox } from "@inquirer/prompts";
import { forgetProjectKey } from "../core/keys";

export function logoutCommand(program: Command) {
  program
    .command("logout")
    .argument("[projects...]")
    .description("Remove remembered project password(s) from the OS keychain")
    .action(async (projects: string[]) => {
      let projectsToLogOut: string[] = projects
        .map((p) => sanitizeName(p) ?? null)
        .filter((p) => p !== null);

      if (projectsToLogOut.length === 0) {
        const availableProjects = await fetchProjects();
        if (availableProjects.length === 0) {
          console.log(chalk.red("✘ No projects found."));
          return;
        }
        projectsToLogOut = await safePrompt(() =>
          checkbox({
            message: "Select projects to log out from:",
            choices: availableProjects.map((p) => ({ name: p, value: p })),
            validate: (choices) =>
              choices.length > 0 || "Please select at least one project.",
          })
        );
      }

      if (projectsToLogOut.length === 0) {
        console.log(chalk.yellow("No projects selected."));
        return;
      }

      let successCount = 0;
      let notFoundCount = 0;

      for (const project of projectsToLogOut) {
        try {
          const success = await forgetProjectKey(project);
          if (success) {
            console.log(chalk.green(`✔ Logged out from project "${project}".`));
            successCount++;
          } else {
            notFoundCount++;
          }
        } catch (err) {
          console.log(
            chalk.red(
              `✘ Failed to log out from project "${project}": ${
                (err as Error).message
              }`
            )
          );
        }
      }

      console.log(
        chalk.cyan("\nLogout summary:") +
          chalk.green(` ${successCount} successful`) +
          chalk.gray(`, ${notFoundCount} had no saved password.`)
      );
      if (successCount > 0) {
        console.log(
          chalk.gray(
            "  You will be prompted for the Master Password on next use."
          )
        );
      }
    });
}
