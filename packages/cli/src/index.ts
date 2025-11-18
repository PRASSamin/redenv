#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import chalk from "chalk";
import {
  GLOBAL_CONFIG_PATH,
  loadProjectConfig,
  loadMemoryConfig,
  saveToMemoryConfig,
  Credential,
} from "./core/config";
import { password, input, select } from "@inquirer/prompts";
import { addCommand } from "./commands/add";
import { registerCommand } from "./commands/register";
import { removeCommand } from "./commands/remove";
import { listCommand } from "./commands/list";
import { viewCommand } from "./commands/view";
import { editCommand } from "./commands/edit";
import packageJson from "../package.json";
import { promoteCommand } from "./commands/promote";
import { switchCommand } from "./commands/switch";
import { cloneCommand } from "./commands/clone";
import { exportCommand } from "./commands/export";
import { diffCommand } from "./commands/diff";
import { importCommand } from "./commands/import";
import { dropCommand } from "./commands/drop";
import { doctorCommand } from "./commands/doctor";
import { logoutCommand } from "./commands/logout";
import { changePasswordCommand } from "./commands/change-password";
import { backupCommand } from "./commands/backup";
import { restoreCommand } from "./commands/restore";
import { tokenCommand } from "./commands/token";
import { historyCommand } from "./commands/history";
import { rollbackCommand } from "./commands/rollback";
import path from "path";
import { safePrompt } from "./utils";

async function main() {
  try {
    // Check for global config before running any command except 'setup' or 'help'
    const invokedCommand = process.argv[2];
    const isHelpCommand =
      process.argv.includes("--help") ||
      process.argv.includes("-h") ||
      invokedCommand === "help";

    if (invokedCommand && invokedCommand !== "setup" && !isHelpCommand) {
      if (!fs.existsSync(GLOBAL_CONFIG_PATH)) {
        throw new Error("Config not found! Run 'redenv setup' first.");
      }
    }

    const program = new Command();
    program
      .name("redenv")
      .description("Centralized Redis environment variables manager")
      .version(packageJson.version);

    const projectConfig = loadProjectConfig();

    // Helper: Check for forbidden keys in project config
    function checkDangerKeys(config: Record<string, any>) {
      const forbidden = Object.keys(config).filter((key) =>
        key.toUpperCase().includes("UPSTASH")
      );
      if (forbidden.length > 0) {
        throw new Error(
          `Danger! You cannot store Redis credentials in project config: ${forbidden.join(
            ", "
          )}`
        );
      }
    }

    if (projectConfig) checkDangerKeys(projectConfig);

    // Register commands
    addCommand(program);
    registerCommand(program);
    removeCommand(program);
    listCommand(program);
    viewCommand(program);
    editCommand(program);
    promoteCommand(program);
    switchCommand(program);
    cloneCommand(program);
    exportCommand(program);
    importCommand(program);
    diffCommand(program);
    dropCommand(program);
    doctorCommand(program);
    logoutCommand(program);
    changePasswordCommand(program);
    backupCommand(program);
    restoreCommand(program);
    tokenCommand(program);
    historyCommand(program);
    rollbackCommand(program);

    // Setup command
    program
      .command("setup")
      .description("Setup redenv global config")
      .action(async () => {
        let urlAns: string;
        let tokenAns: string;

        const memory = loadMemoryConfig();

          if (memory.length === 0) {
            // First time run or empty memory
            console.log(chalk.blue("Setting up new Upstash credentials..."));
            urlAns = await safePrompt(() =>
              input({
                message: "Enter your Upstash Redis URL:",
                validate: (i) =>
                  i.startsWith("http") ? true : "Not a valid URL",
              })
            );
            tokenAns = await safePrompt(() =>
              password({
                message: "Enter your Upstash Redis Token:",
                mask: "*",
                validate: (i) =>
                  i.length > 0 ? true : "Token cannot be empty",
              })
            );
          } else {
            // Has memory, show select prompt
            const choice: Credential | "new" = await safePrompt(() =>
              select({
                message: "Select Upstash credentials:",
                choices: [
                  // @ts-expect-error: Type narrowing issue with union type - handling Credential | "new" union
                  ...memory
                    .map((mem) => ({
                      name: `${mem.url} | ****${mem.token.slice(
                        -4
                      )} | ${new Date(mem.createdAt).toLocaleString()}`,
                      value: mem,
                    }))
                    .filter(
                      (mem) => mem.name !== undefined && mem.name !== null
                    ),
                  // @ts-expect-error: Type narrowing issue with union type - handling Credential | "new" union
                  { name: "✨ Use new credentials", value: "new" },
                ],
              })
            );

            if (typeof choice === "string" && choice === "new") {
              urlAns = await safePrompt(() =>
                input({
                  message: "Enter your new Upstash Redis URL:",
                  validate: (i) =>
                    i.startsWith("http") ? true : "Not a valid URL",
                })
              );
              tokenAns = await safePrompt(() =>
                password({
                  message: "Enter your new Upstash Redis Token:",
                  mask: "*",
                  validate: (i) =>
                    i.length > 0 ? true : "Token cannot be empty",
                })
              );
            } else {
              // User selected existing credentials
              urlAns = choice.url;
              tokenAns = choice.token;
              console.log(chalk.green(`Using saved credentials for ${urlAns}`));
            }
          }

          // Save the chosen/new credentials to memory
          saveToMemoryConfig({
            url: urlAns,
            token: tokenAns,
            createdAt: new Date().toISOString(),
          });

          const email = await safePrompt(() =>
            input({
              message: "Please enter your email for auditing purposes:",
              validate: (val) =>
                val.includes("@") ? true : "Please enter a valid email.",
            })
          );

          // Save to global config
          const data = {
            url: urlAns,
            token: tokenAns,
            email: email,
            createdAt: new Date().toISOString(),
          };

          const configDir = path.dirname(GLOBAL_CONFIG_PATH);
          if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
          }

          fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(data, null, 2));
          console.log(chalk.green("\n✔ Global config saved successfully!"));
      });

    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof Error) {
      console.log(chalk.red(`✘ ${err.message}`));
    } else {
      console.log(chalk.red("✘ An unknown error occurred."));
    }
    process.exit(1);
  }
}

main();
