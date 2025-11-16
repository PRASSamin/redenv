import chalk from "chalk";
import ora from "ora";
import { Command } from "commander";
import { redis } from "../core/upstash";
import { select, checkbox, input } from "@inquirer/prompts";
import { loadProjectConfig } from "../core/config";
import { nameValidator, safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";

export function cloneCommand(program: Command) {
  program
    .command("clone")
    .argument("[key]", "Clone only a specific key (optional)")
    .description("Clone environment variables from one environment to another")
    .option("-f, --from <env>", "Source environment")
    .option("-t, --to <env>", "Destination environment")
    .option("-p, --project <name>", "Project name")
    .option("--skip-config", "Ignore local project config file")
    .action(async (keyArg, options) => {
      let { from, to } = options;
      let project = sanitizeName(options.project);
      from = sanitizeName(from);
      to = sanitizeName(to);

      // ---------------------------------------------------------
      // CONFIG OR NO CONFIG BEHAVIOR
      // ---------------------------------------------------------
      let config = options.project ? null : loadProjectConfig();

      // If no project passed + using config, use config project
      project = project || config?.name;
      if (!project) {
        const projects = await fetchProjects();

        if (projects.length === 0) {
          console.log(chalk.red("✘ No projects found in Redis."));
          return;
        }

        project = await safePrompt(() =>
          select({
            message: "Select project:",
            choices: projects,
          })
        );
      }

      // ---------------------------------------------------------
      // ASK ENVIRONMENTS IF MISSING
      // ---------------------------------------------------------
      const envs = (await fetchEnvironments(project || "")) || [];

      if (!envs.length || envs.length === 0) {
        console.log(
          chalk.red('✘ No environments found for project "' + project + '".')
        );
        return;
      }

      if (!from) {
        from = await safePrompt(() =>
          select({
            message: "Select source environment:",
            choices: envs,
          })
        );
      }

      if (!to) {
        to = await safePrompt(() =>
          select({
            message: "Select destination environment:",
            choices: [...envs.filter((e) => e !== from), "New environment"],
          })
        );
        if (to === "New environment") {
          to = await safePrompt(() =>
            input({
              required: true,
              message: "Enter new environment name:",
              validate: (input) => {
                if (input === from)
                  return "Environment name cannot be the same as source.";
                return nameValidator(input);
              },
            })
          );
        }
      }

      // ---------------------------------------------------------
      // LOAD SOURCE + DEST VARS
      // ---------------------------------------------------------
      const sourceKey = `${from}:${project}`;
      const destKey = `${to}:${project}`;

      const spinner = ora("Loading variables...").start();

      let sourceVars = {};
      let destVars = {};

      try {
        sourceVars = (await redis.hgetall(sourceKey)) || {};
        destVars = (await redis.hgetall(destKey)) || {};
        spinner.stop();
      } catch (err) {
        spinner.fail(chalk.red(`Failed: ${(err as Error).message}`));
        return;
      }

      if (Object.keys(sourceVars).length === 0) {
        console.log(chalk.red("✘ Source environment has no variables."));
        return;
      }

      // ---------------------------------------------------------
      // DETERMINE WHICH KEYS CAN BE CLONED
      // ---------------------------------------------------------
      let missingKeys = Object.keys(sourceVars).filter((k) => !(k in destVars));

      if (missingKeys.length === 0) {
        console.log(
          chalk.green(
            `✔ Everything is already synced! No new keys to clone from ${from} → ${to}.`
          )
        );
        return;
      }

      let selectedKeys: string[] = [];

      // User passed one specific key
      if (keyArg) {
        if (!missingKeys.includes(keyArg)) {
          console.log(
            chalk.yellow(
              `✘ Key '${keyArg}' already exists in ${to} environment.`
            )
          );
          return;
        }
        selectedKeys = [keyArg];
      } else {
        // Multi-select missing keys
        try {
          selectedKeys = await checkbox({
            message: `Select keys to clone into ${to}:`,
            choices: missingKeys.map((k) => ({ name: k, value: k })),
            loop: false,
          });
        } catch (err) {
          if (err instanceof Error && err.name === "ExitPromptError") {
            console.log(chalk.yellow("Cancelled"));
            return;
          }
          throw err;
        }

        if (selectedKeys.length === 0) {
          console.log(chalk.yellow("✘ No keys selected."));
          return;
        }
      }

      // Prepare data to push
      const newData = {};
      for (const k of selectedKeys) {
        newData[k as keyof typeof sourceVars] =
          sourceVars[k as keyof typeof sourceVars];
      }

      console.log(chalk.cyan("\nKeys to clone:"));
      for (const k of selectedKeys)
        console.log(`  • ${k}=${sourceVars[k as keyof typeof sourceVars]}`);

      const confirm = await select({
        message: "Proceed?",
        choices: ["yes", "no"],
      });

      if (confirm === "no") {
        console.log(chalk.yellow("✘ Cancelled."));
        return;
      }

      // ---------------------------------------------------------
      // APPLY CLONE
      // ---------------------------------------------------------
      const apply = ora("Cloning...").start();

      try {
        await redis.hset(destKey, newData);
        apply.succeed(
          chalk.green(
            `✔ Successfully cloned ${selectedKeys.length} key(s) from ${from} → ${to}!`
          )
        );
      } catch (err) {
        apply.fail(chalk.red(`Failed: ${(err as Error).message}`));
      }
    });
}
