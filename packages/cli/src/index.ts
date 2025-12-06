#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import chalk from "chalk";
import { GLOBAL_CONFIG_PATH, loadProjectConfig } from "./core/config";
import { addCommand } from "./commands/add";
import { registerCommand } from "./commands/register";
import { removeCommand } from "./commands/remove";
import { listCommand } from "./commands/list";
import { viewCommand } from "./commands/view";
import { editCommand } from "./commands/edit";
import packageJson from "../package.json";
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
import { shellCommand } from "./commands/shell";
import { setupCommand } from "./commands/setup";
import { syncCommand } from "./commands/sync";

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

    const projectConfig = await loadProjectConfig();

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
    backupCommand(program);
    changePasswordCommand(program);
    cloneCommand(program);
    diffCommand(program);
    doctorCommand(program);
    dropCommand(program);
    editCommand(program);
    exportCommand(program);
    historyCommand(program);
    importCommand(program);
    listCommand(program);
    logoutCommand(program);
    registerCommand(program);
    removeCommand(program);
    restoreCommand(program);
    rollbackCommand(program);
    setupCommand(program);
    shellCommand(program);
    switchCommand(program);
    tokenCommand(program);
    viewCommand(program);
    syncCommand(program);

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
