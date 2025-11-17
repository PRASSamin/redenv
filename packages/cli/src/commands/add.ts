import chalk from "chalk";
import ora from "ora";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { sanitizeName, safePrompt } from "../utils";
import { unlockProject } from "../core/keys";
import { fetchEnvironments, writeSecret } from "../utils/redis";
import { select } from "@inquirer/prompts";

export function addCommand(program: Command) {
  program
    .command("add")
    .argument("<key>", "The ENV key to add")
    .argument("<value>", "The value to assign to the ENV key")
    .description("Add a new environment variable to your project")
    .option("-p, --project <name>", "Specify the project name")
    .option("-e, --env <env>", "Specify the environment")
    .action(async (key, value, options) => {
      const projectConfig = loadProjectConfig();

      if (!projectConfig && !options.project) {
        console.log(
          chalk.red(
            "✘ No project registered. Use `redenv register <name>` or pass `--project <name>`."
          )
        );
        return;
      }

      const projectName =
        sanitizeName(options.project) || projectConfig?.name!;
      let environment =
        sanitizeName(options.env) || projectConfig?.environment;

      if (!environment) {
        const envs = await fetchEnvironments(projectName, true);
        environment = await safePrompt(() =>
          select({
            message: "Select environment:",
            choices: envs.map((e) => ({ name: e, value: e })),
          })
        );
      }

      let spinner: ora.Ora | undefined;
      try {
        const pek = await unlockProject(projectName);
        spinner = ora(
          `Adding ${chalk.cyan(key)} to ${chalk.yellow(
            projectName
          )} (${environment})...`
        ).start();

        await writeSecret(projectName, environment, key, value, pek, {
          isNew: true,
        });

        spinner.succeed(
          chalk.greenBright(
            `Added '${key}' → ${chalk.cyan(
              value
            )} in ${projectName} (${environment})`
          )
        );
      } catch (err) {
        const error = err as Error;
        if (spinner && spinner.isSpinning) {
          spinner.fail(chalk.red(error.message));
        } else if (error.name !== "ExitPromptError") {
          console.log(
            chalk.red(`\n✘ An unexpected error occurred: ${error.message}`)
          );
        }
        process.exit(1);
      }
    });
}
