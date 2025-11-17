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
import { unlockProject } from "../core/keys";
import { decrypt, encrypt } from "../core/crypto";

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

      // --- Project and Environment Selection ---
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

      // --- Unlock Project ---
      const pek = await unlockProject(projectName);

      // --- Parse .env file ---
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

      // --- Compare with remote ---
      const redisKey = `${environment}:${projectName}`;
      const spinner2 = ora("Fetching and decrypting existing variables...").start();
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
        console.log(chalk.yellow(`⚠ The following keys already exist in ${environment}:${projectName}:\n`));
        const keysWithDiff: string[] = [];

        for (const k of conflictingKeys) {
          const newValue = normalize(parsed[k]);
          let existingValue = "";
          try {
            existingValue = normalize(decrypt(existing[k], pek));
          } catch {
            // If decryption fails, treat it as a different value
            existingValue = `[un-decryptable value] ${existing[k]}`;
          }

          if (existingValue === newValue) {
            skippedKeys.push(k);
          } else {
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

      // --- Encrypt and Upload ---
      const spinner3 = ora("Encrypting and importing variables...").start();
      try {
        const finalObject: Record<string, string> = {};
        for (const key of keysToImport) {
          finalObject[key] = encrypt(parsed[key], pek);
        }
        await redis.hset(redisKey, finalObject);
        spinner3.succeed(chalk.green(`Imported ${keysToImport.length} variable(s).`));
      } catch (err) {
        spinner3.fail(chalk.red(`Failed to import variables: ${(err as Error).message}`));
      }

      console.log("");
    });
}
