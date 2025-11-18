import fs from "fs";
import chalk from "chalk";
import ora from "ora";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { confirm, input, select } from "@inquirer/prompts";
import { nameValidator, normalize, safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects, writeSecret } from "../utils/redis";
import dotenv from "dotenv";
import { unlockProject } from "../core/keys";
import { decrypt } from "../core/crypto";
import { redis } from "../core/upstash";

export function importCommand(program: Command) {
  program
    .command("import")
    .argument("<file>", "Path to .env file")
    .description("Import environment variables from a .env file")
    .option("--skip-config", "Ignore project config file")
    .option("-p, --project <name>", "Specify project name")
    .option("-e, --env <env>", "Specify environment")
    .action(async (filePath, options) => {
      if (!fs.existsSync(filePath)) {
        console.log(chalk.red(`✘ File not found: ${filePath}`));
        return;
      }

      const config = options.skipConfig ? null : loadProjectConfig();
      let projectName = sanitizeName(options.project) || config?.name;
      let environment = sanitizeName(options.env) || config?.environment;

      if (!projectName) {
        const projects = await fetchProjects();
        projectName = await safePrompt(() =>
          select({
            message: "Select project:",
            choices: [...projects.map((p) => ({ name: p, value: p })), { name: "New Project", value: "New Project" }],
          })
        );
        if (projectName === "New Project") {
          projectName = await safePrompt(() =>
            input({
              message: "Enter new project name:",
              required: true,
              validate: nameValidator,
            })
          );
        }
      }

      if (!environment) {
        const envs = await fetchEnvironments(projectName);
        environment = await safePrompt(() =>
          select({
            message: "Select environment:",
            choices: [...envs.map((e) => ({ name: e, value: e })), { name: "New environment", value: "New environment" }],
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

      const pek = await unlockProject(projectName);

      const spinner = ora("Parsing .env file...").start();
      let parsed: Record<string, string> = {};
      try {
        const fileContent = fs.readFileSync(filePath, "utf8");
        parsed = dotenv.parse(fileContent);
        spinner.succeed(chalk.green("Parsed .env file"));
      } catch (err) {
        spinner.fail(chalk.red(`Failed to parse .env file: ${(err as Error).message}`));
        return;
      }

      const redisKey = `${environment}:${projectName}`;
      spinner.start("Fetching and decrypting existing variables...");
      let existing: Record<string, any> = {};
      try {
        existing = (await redis.hgetall(redisKey)) || {};
        spinner.succeed(chalk.green("Loaded existing vars"));
      } catch (err) {
        spinner.fail(chalk.red(`Failed to load existing environment: ${(err as Error).message}`));
        return;
      }

      const keysInFile = Object.keys(parsed);
      const keysInRedis = Object.keys(existing);
      const conflictingKeys = keysInFile.filter((k) => keysInRedis.includes(k));
      const newKeys = keysInFile.filter((k) => !keysInRedis.includes(k));

      const keysToImport: string[] = [];
      
      console.log("");
      if (conflictingKeys.length > 0) {
        console.log(chalk.yellow(`⚠ The following keys already exist in ${environment}:${projectName}:
`));
        const keysWithDiff: string[] = [];

        for (const k of conflictingKeys) {
          const newValue = normalize(parsed[k]);
          let existingValue = "";
          try {
            const history = existing[k];
            if (!Array.isArray(history) || history.length === 0) throw new Error();
            existingValue = normalize(await decrypt(history[0].value, pek));
          } catch {
            existingValue = `[un-decryptable or invalid format]`;
          }

          if (existingValue !== newValue) {
            keysWithDiff.push(k);
            console.log(chalk.yellow(`~ ${k}   current="${existingValue}" | new="${newValue}"`));
          }
        }

        if (keysWithDiff.length > 0) {
          const override = await safePrompt(() => confirm({ message: "Do you want to override these existing keys?" }));
          if (override) keysToImport.push(...keysWithDiff);
        }
      }

      keysToImport.push(...newKeys);

      if (keysToImport.length === 0) {
        console.log(chalk.green("✔ Nothing to import. All keys are in sync or skipped."));
        return;
      }

      console.log("");
      console.log(chalk.cyan("Keys to import:"));
      keysToImport.forEach((k) => console.log(chalk.green(`+ ${k}="${parsed[k]}"`)));

      console.log("");
      const confirmImport = await safePrompt(() => confirm({ message: `Import ${keysToImport.length} variable(s) into ${environment}:${projectName}?` }));

      if (!confirmImport) {
        console.log(chalk.red("✘ Import cancelled."));
        return;
      }

      spinner.start("Encrypting and importing variables...");
      try {
        for (const key of keysToImport) {
            const isNew = !keysInRedis.includes(key);
            await writeSecret(projectName, environment, key, parsed[key], pek, { isNew });
        }
        spinner.succeed(chalk.green(`Imported ${keysToImport.length} variable(s).`));
      } catch (err) {
        spinner.fail(chalk.red(`Failed to import variables: ${(err as Error).message}`));
      }

      console.log("");
    });
}