import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";
import { Command } from "commander";
import { redis } from "../core/upstash";
import { loadProjectConfig } from "../core/config";
import { confirm, checkbox, select } from "@inquirer/prompts";
import { normalize, safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";
import dotenv from "dotenv";
import { unlockProject } from "../core/keys";
import { decrypt } from "@redenv/core";

export function exportCommand(program: Command) {
  program
    .command("export")
    .description("Export environment variables into a .env file")
    .option("--skip-config", "Ignore project config file")
    .option("-p, --project <name>", "Specify project name")
    .option("-e, --env <env>", "Specify environment")
    .option("-f, --file <path>", "Output file (default: .env)", ".env")
    .action(async (options) => {
      const config = options.skipConfig ? null : loadProjectConfig();
      let projectName = sanitizeName(options.project) || config?.name;
      let environment = sanitizeName(options.env) || config?.environment;
      const outputFile = options.file;

      if (!projectName) {
        const projects = await fetchProjects();
        if (!projects.length) {
          console.log(chalk.red("✘ No projects found in Redis."));
          return;
        }
        projectName = await safePrompt(() =>
          select({
            message: "Select project:",
            choices: projects.map((p) => ({ name: p, value: p })),
          })
        );
      }

      if (!environment) {
        const envs = await fetchEnvironments(projectName, true);
        environment = await safePrompt(() =>
          select({
            message: "Select environment:",
            choices: envs.map((e) => ({ name: e, value: e })),
          })
        );
      }

      const pek = await unlockProject(projectName);

      const redisKey = `${environment}:${projectName}`;
      const spinner =
        ora(`Fetching variables from ${projectName} (${environment})...
`).start();
      let versionedVars: Record<string, any> = {};
      try {
        versionedVars = (await redis.hgetall(redisKey)) || {};
        spinner.succeed(chalk.green("Variables fetched"));
      } catch (err) {
        spinner.fail(
          chalk.red(`Failed to fetch variables: ${(err as Error).message}`)
        );
        return;
      }

      if (!Object.keys(versionedVars).length) {
        console.log(chalk.yellow("⚠ No variables found to export."));
        return;
      }

      let selectedKeys: string[];
      try {
        const exportAll = await safePrompt(() =>
          confirm({ message: "Export ALL keys?", default: true })
        );
        if (exportAll) {
          selectedKeys = Object.keys(versionedVars);
        } else {
          selectedKeys = await safePrompt(() =>
            checkbox({
              message: "Select keys to export:",
              choices: Object.keys(versionedVars).map((k) => ({
                name: k,
                value: k,
              })),
              loop: false,
            })
          );
          if (!selectedKeys.length) {
            console.log(chalk.yellow("⚠ No keys selected. Cancelled."));
            return;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") {
          console.log(chalk.yellow("Cancelled"));
          return;
        }
        throw err;
      }

      const filePath = path.resolve(process.cwd(), outputFile);
      let existingContent = "";
      let existingVars: Record<string, string> = {};
      if (fs.existsSync(filePath)) {
        existingContent = fs.readFileSync(filePath, "utf8");
        existingVars = dotenv.parse(existingContent);
      }

      const conflicts = selectedKeys.filter((key) =>
        Object.prototype.hasOwnProperty.call(existingVars, key)
      );

      const diffPromises = conflicts.map(async (key) => {
        try {
          const history = versionedVars[key];
          if (!Array.isArray(history) || history.length === 0)
            return { key, isDiff: true };
          const decryptedValue = await decrypt(history[0].value, pek);
          const isDiff =
            normalize(existingVars[key]) !== normalize(decryptedValue);
          return { key, isDiff };
        } catch {
          return { key, isDiff: true }; // Treat un-decryptable values as different
        }
      });

      const diffResults = await Promise.all(diffPromises);
      const diffValues = diffResults.filter((r) => r.isDiff).map((r) => r.key);

      let override = false;
      if (diffValues.length > 0) {
        override = await safePrompt(() =>
          confirm({
            message: `The following keys already exist with different values: ${chalk.magenta(
              diffValues.join(", ")
            )}. Override them?`,
            default: false,
          })
        );
      }

      const newKeys = selectedKeys.filter((k) => !conflicts.includes(k));
      const keysToWrite = [...newKeys];
      if (override) {
        keysToWrite.push(...diffValues);
      }

      if (keysToWrite.length === 0) {
        console.log(
          chalk.green("✔ Nothing to export. Everything is already in sync.")
        );
        return;
      }

      let finalContent = existingContent;
      const keysToOverride = override ? diffValues : [];

      if (keysToOverride.length > 0) {
        const lines = finalContent.split("\n");
        const newLines = lines.map((line) => {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith("#") || !trimmedLine.includes("="))
            return line;
          const keyMatch = trimmedLine.match(/^([^=]+)=/);
          if (keyMatch) {
            const key = keyMatch[1]?.trim();
            if (!key) return line;
            if (keysToOverride.includes(key)) {
              return `# ${line} # overridden by redenv`;
            }
          }
          return line;
        });
        finalContent = newLines.join("\n");
      }

      let contentToAppend = "";
      if (keysToWrite.length > 0) {
        contentToAppend +=
          finalContent.endsWith("\n\n") || finalContent.length === 0
            ? ""
            : "\n";
        contentToAppend += `\n# Variables exported by redenv from ${projectName} (${environment}) at ${new Date().toISOString()}\n`;

        const decryptionPromises = keysToWrite.map(async (key) => {
          try {
            const history = versionedVars[key];
            if (!Array.isArray(history) || history.length === 0)
              throw new Error();
            const decryptedValue = await decrypt(history[0].value, pek);
            return `${key}="${decryptedValue}"\n`;
          } catch {
            return `# ${key}="[redenv: could not decrypt value]"\n`;
          }
        });
        const linesToAppend = await Promise.all(decryptionPromises);
        contentToAppend += linesToAppend.join("");
      }

      finalContent += contentToAppend;

      try {
        fs.writeFileSync(filePath, finalContent);
        console.log(
          chalk.green(
            `✔ Exported ${keysToWrite.length} keys to ${chalk.blue(outputFile)}`
          )
        );
      } catch (err) {
        console.log(
          chalk.red(`✘ Failed to write file: ${(err as Error).message}`)
        );
      }
    });
}
