import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { loadProjectConfig } from "../core/config";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, writeSecret } from "../utils/redis";
import { select } from "@inquirer/prompts";
import { multiline } from "@cli-prompts/multiline";
import { unlockProject } from "../core/keys";

export function editCommand(program: Command) {
  program
    .command("edit")
    .argument("<key>", "The ENV key to modify")
    .description("Update an existing environment variable’s value")
    .option("-p, --project <name>", "Specify the project name")
    .option("-e, --env <env>", "Specify the environment")
    .action(async (key, options) => {
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
        sanitizeName(options.project) || projectConfig?.name;
      let environment =
        sanitizeName(options.env) || projectConfig?.environment;

      if (!environment) {
        const envs = (await fetchEnvironments(projectName, true)) || [];
        environment = await safePrompt(() =>
          select({
            message: "Select environment:",
            loop: false,
            choices: envs.map((e) => ({ name: e, value: e })),
          })
        );
      }

      let spinner;
      try {
        const pek = await unlockProject(projectName);

        const newValue = await safePrompt(() =>
          multiline({
            prompt: `Enter new value for ${chalk.cyan(key)}`,
            required: true,
            validate(value) {
              if (!value.trim()) return "You must enter something.";
              return true;
            },
          })
        );

        spinner = ora(
          `Updating ${chalk.cyan(key)} in ${chalk.yellow(
            projectName
          )} (${environment})...`
        ).start();

        await writeSecret(projectName, environment, key, newValue, pek, {
          isNew: false,
        });

        spinner.succeed(
          chalk.greenBright(
            `Updated '${key}' → ${chalk.cyan(
              newValue
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
