import fs from "fs";
import chalk from "chalk";
import ora from "ora";
import { Command } from "commander";
import { redis } from "../core/upstash";
import { loadProjectConfig } from "../core/config";
import { confirm, input, select } from "@inquirer/prompts";
import { nameValidator, normalize, safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";
import dotenv from "dotenv";

export function importCommand(program: Command) {
  program
    .command("import")
    .argument("<file>", "Path to .env file")
    .description("Import environment variables from a .env file")
    .option("--skip-config", "Ignore project config file")
    .option("-p, --project <name>", "Specify project name")
    .option("-e, --env <env>", "Specify environment")
    .action(async (filePath, options) => {
      const config = options.skipConfig ? null : loadProjectConfig();
      let projectName = sanitizeName(options.project) || config?.name;
      let environment = sanitizeName(options.env) || config?.environment;

      if (!fs.existsSync(filePath)) {
        console.log(chalk.red(`✘ File not found: ${filePath}`));
        return;
      }

      if (!projectName) {
        const projects = await fetchProjects();

        projectName = await safePrompt(() =>
          select({
            message: "Select project:",
            choices: [...projects, "New Project"],
          })
        );

        if (projectName === "New Project") {
          projectName = await safePrompt(() =>
            input({
              message: "Enter project name:",
              required: true,
              validate: nameValidator,
            })
          );
        }
      }
      if (!environment) environment = config?.environment;
      if (!environment) {
        const envs = await fetchEnvironments(projectName);

        environment = await safePrompt(() =>
          select({
            message: "Select environment:",
            choices: [
              ...envs.filter((e) => e !== "production" && e !== "development"),
              "production",
              "development",
              "New environment",
            ],
          })
        );
        if (environment === "New environment") {
          environment = await safePrompt(() =>
            input({
              required: true,
              message: "Enter environment name:",
              validate: nameValidator,
            })
          );
        }
      }

      const spinner = ora("Parsing .env file...").start();
      let parsed: Record<string, string> = {};
      try {
        const fileContent = fs.readFileSync(filePath, "utf8");
        parsed = dotenv.parse(fileContent);
        spinner.succeed(chalk.green("Parsed .env file"));
      } catch (err) {
        spinner.fail(chalk.red("Failed to parse .env file"));
        return;
      }

      const redisKey = `${environment}:${projectName}`;
      const spinner2 = ora(
        "Fetching existing environment variables..."
      ).start();
      let existing: Record<string, string> = {};
      try {
        existing = (await redis.hgetall(redisKey)) || {};
        spinner2.succeed(chalk.green("Loaded existing vars"));
      } catch (err) {
        spinner2.fail(chalk.red("Failed to load existing environment"));
        return;
      }

      const keysInFile = Object.keys(parsed);
      const keysInRedis = Object.keys(existing);
      const conflictingKeys = keysInFile.filter((k) => keysInRedis.includes(k));
      const newKeys = keysInFile.filter((k) => !keysInRedis.includes(k));

      const keysToImport: string[] = [];
      const skippedKeys: string[] = [];

      console.log("");
      if (conflictingKeys.length > 0) {
        console.log(
          chalk.yellow(
            `⚠ The following keys already exist in ${environment}:${projectName}:\n`
          )
        );

        const keysWithDiff: string[] = [];

        conflictingKeys.forEach((k) => {
          const currentValue = normalize(existing[k]);
          const newValue = normalize(parsed[k]);
          if (currentValue === newValue) {
            skippedKeys.push(k);
            console.log(
              chalk.gray(
                `✔ ${k}   current="${currentValue}" | new="${newValue}" (no change)`
              )
            );
          } else {
            keysWithDiff.push(k);
            console.log(
              chalk.yellow(
                `~ ${k}   current="${currentValue}" | new="${newValue}"`
              )
            );
          }
        });

        if (keysWithDiff.length > 0) {
          try {
            const override = await confirm({
              message: "Do you want to override these existing keys?",
            });
            if (override) keysToImport.push(...keysWithDiff);
          } catch (err) {
            if (err instanceof Error && err.name === "ExitPromptError") {
              console.log(chalk.yellow("Cancelled"));
              return;
            }
            throw err;
          }
        }
      }

      keysToImport.push(...newKeys);

      if (keysToImport.length === 0) {
        console.log(
          chalk.green("✔ Nothing to import. All keys are in sync or skipped.")
        );
        return;
      }

      console.log("");
      console.log(chalk.cyan("Keys to import:"));
      keysToImport.forEach((k) =>
        console.log(chalk.green(`+ ${k}="${parsed[k]}"`))
      );

      console.log("");
      let confirmImport: boolean;
      try {
        confirmImport = await confirm({
          message: `Import ${keysToImport.length} variable(s) into ${environment}:${projectName}?`,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") {
          console.log(chalk.yellow("Cancelled"));
          return;
        }
        throw err;
      }

      if (!confirmImport) {
        console.log(chalk.red("✘ Import cancelled."));
        return;
      }

      const spinner3 = ora("Importing variables...").start();
      try {
        const finalObject: Record<string, string> = {};
        for (const key of keysToImport) finalObject[key] = parsed[key];
        await redis.hset(redisKey, finalObject);
        spinner3.succeed(
          chalk.green(`Imported ${keysToImport.length} variable(s).`)
        );
      } catch (err) {
        spinner3.fail(
          chalk.red(`Failed to import variables: ${(err as Error).message}`)
        );
      }

      console.log("");
    });
}
