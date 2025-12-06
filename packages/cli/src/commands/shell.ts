import {
  sanitizeName,
  safePrompt,
  getAuditUser,
  UserCancelledError,
  ContextSwitchRequest,
} from "../utils";
import { unlockProject } from "../core/keys";
import { fetchEnvironments } from "../utils/redis";
import { select } from "@inquirer/prompts";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import chalk from "chalk";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "child_process";
import Table from "cli-table3";
import { commandActions } from "./registry";

/**
 * Creates a responsive, dynamic header for the shell.
 */
function createHeader(projectName: string, environment: string, user: string) {
  const table = new Table({
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      middle: "│",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
    },
  });

  const welcome = `🚀  ${chalk.bold.blue(
    "Welcome to the Redenv Interactive Shell"
  )}`;

  table.push([{ colSpan: 2, content: welcome, hAlign: "center" }]);
  table.push(
    [chalk.bold("Project"), chalk.cyan(projectName)],
    [chalk.bold("Environment"), chalk.yellow(environment)],
    [chalk.bold("User"), chalk.gray(user)]
  );

  return "\n" + table.toString();
}

/**
 * Recreates command structures inside the shell.
 * Zero cloning of internal objects. Pure Commander-safe wiring.
 */
async function wireCommand(
  sourceCmd: Command,
  targetParent: Command,
  context: { projectName: string; environment: string; pek: CryptoKey },
  isSubCommand: boolean
) {
  // Skip shell/setup commands
  if (["shell", "setup"].includes(sourceCmd.name())) return;

  const newCmd = targetParent.command(sourceCmd.name());

  // Copy args
  sourceCmd.registeredArguments.forEach((arg) => {
    const isReq = arg.required;
    const name = arg.name();
    newCmd.argument(
      `${isReq ? "<" : "["}${name}${name.endsWith("s") ? "..." : ""}${
        isReq ? ">" : "]"
      }`,
      arg.description
    );
  });

  // Copy options except project/env
  sourceCmd.options.forEach((opt) => {
    newCmd.option(`${opt.flags}`, opt.description, opt.defaultValue);
  });

  newCmd.description(sourceCmd.description());
  newCmd.helpCommand(sourceCmd.helpInformation());

  const commandKey = isSubCommand
    ? `${sourceCmd.parent?.name()}:${sourceCmd.name()}`
    : sourceCmd.name();

  // Attach action safely from the registry
  const commandAction = commandActions[commandKey];

  if (commandAction && typeof commandAction === "function") {
    newCmd.action(async (...args: any[]) => {
      // Pop the command and options objects from the end of the args array.
      args.pop() as Command; // remove command
      const originalOpts = args.pop() as Record<string, any>;

      // `args` now contains only the command's arguments.

      // Create a new, mutable options object that includes the shell's context.
      const newOpts = {
        ...originalOpts,
        project: context.projectName,
        env: context.environment,
        pek: context.pek,
      };

      // Reconstruct the arguments for the action function: [arg1, arg2, ..., newOptions]
      const finalArgs = [...args, newOpts];

      // Call the original action with the corrected arguments.
      await commandAction(...finalArgs);
    });
  }

  // Recursively handle subcommands
  sourceCmd.commands.forEach((sub) => {
    wireCommand(sub, newCmd, context, true);
  });
}

export function shellCommand(program: Command) {
  program
    .command("shell")
    .description("Start an interactive shell for a project environment")
    .option("-p, --project <name>", "Specify the project name")
    .option("-e, --env <env>", "Specify the environment")
    .action(async (options) => {
      // Set an environment variable to signal that the shell is active
      process.env.REDENV_SHELL_ACTIVE = "true";

      const projectConfig = await loadProjectConfig();
      let projectName = sanitizeName(options.project) || projectConfig?.name;

      if (!projectName) {
        console.log(
          chalk.red(
            "✘ No project specified. Use `redenv shell -p <name>` or run from a registered project directory."
          )
        );
        return;
      }

      let environment = sanitizeName(options.env) || projectConfig?.environment;

      if (!environment) {
        const envs = await fetchEnvironments(projectName, true);
        environment = await safePrompt(() =>
          select({
            message: "Select environment:",
            choices: envs.map((e) => ({ name: e, value: e })),
          })
        );
      }

      const EXIT_SHELL = new Error("EXIT_SHELL");
      let history: string[] = [];

      mainLoop: while (true) {
        try {
          console.log(
            chalk.blue(
              `\nConnecting to ${chalk.bold(projectName)} (${chalk.yellow(
                environment
              )})...`
            )
          );

          const pek = await unlockProject(projectName);

          // Display the new responsive header
          const user = getAuditUser();
          console.log(createHeader(projectName, environment, user));
          console.log(
            chalk.gray('  Type "help" for commands, or "exit" to quit.\n')
          );

          // Create REPL-local Commander
          const shellProgram = new Command()
            .version(program.version()!)
            .exitOverride()
            .configureOutput({
              writeErr: () => {},
              writeOut: (str) => output.write(str),
            });

          for (const cmd of program.commands) {
            await wireCommand(
              cmd,
              shellProgram,
              {
                projectName,
                environment,
                pek,
              },
              false
            );
          }

          const prompt = `${chalk.blue.bold("redenv")} ${chalk.gray(
            "›"
          )} ${chalk.cyan(projectName)}${chalk.gray(":")}${chalk.yellow(
            environment
          )} ${chalk.white("$ ")}`;

          // Whitelist of safe system commands
          const allowedSystemCommands = ["clear", "ls", "pwd", "echo"];

          // REPL LOOP
          while (true) {
            const rl = readline.createInterface({ input, output, history });
            const answer = await rl.question(prompt);
            history = (rl as any)?.history;
            rl.close();

            const args = answer.trim().split(" ").filter(Boolean);

            if (args.length === 0) continue;

            const cmdName = args[0]!;

            if (cmdName === "exit" || cmdName === "quit") throw EXIT_SHELL;

            // Handle system commands before anything else
            if (allowedSystemCommands.includes(cmdName)) {
              const child = spawn(cmdName, args.slice(1), {
                stdio: "inherit",
                shell: true,
              });
              await new Promise((resolve) => {
                child.on("close", resolve);
              });
              continue;
            }

            if (cmdName === "help") {
              if (args.length > 1) {
                console.log(
                  shellProgram.commands
                    .find((c) => c.name() === args[1])
                    ?.helpInformation()
                );
              } else {
                console.log(shellProgram.helpInformation());
              }
              continue;
            }

            const hasChild = shellProgram.commands.some(
              (c) => c.name() === cmdName && c.commands.length > 0
            );

            if (hasChild && args.length === 1) {
              console.log(
                shellProgram.commands
                  .find((c) => c.name() === cmdName)
                  ?.helpInformation()
              );
              continue;
            }

            try {
              await shellProgram.parseAsync(args, { from: "user" });
            } catch (err: any) {
              if (err instanceof ContextSwitchRequest) {
                throw err; // Re-throw to be caught by the outer loop
              }
              if (err.message === UserCancelledError) {
                // User cancelled a prompt, just continue to the next line.
                continue;
              }
              if (err.code === "commander.unknownCommand") {
                console.log(chalk.red(`✘ Unknown command: "${cmdName}"`));
              } else if (err.code === "commander.help") {
                // skip
              } else if (
                err.code === "commander.missingArgument" ||
                err.code === "commander.optionMissingArgument"
              ) {
                console.log(chalk.red(`✘ Missing argument: ${err.message}`));
              } else {
                console.log(
                  chalk.red(`✘ Error: ${err.message || String(err)}`)
                );
              }
            }
          }
        } catch (err: any) {
          if (err === EXIT_SHELL) {
            break mainLoop;
          }

          if (err instanceof ContextSwitchRequest) {
            console.log(chalk.blue(`\nSwitching context...`));
            if (err.newProject) {
              projectName = err.newProject;
              const newEnvs = await fetchEnvironments(projectName);
              if (newEnvs.length === 0) {
                console.log(
                  chalk.red(
                    `✘ Project "${projectName}" has no environments. Exiting shell.`
                  )
                );
                break mainLoop;
              }
              if (!newEnvs.includes(environment)) {
                console.log(
                  chalk.yellow(
                    `  Environment "${environment}" not found in new project. Please select one.`
                  )
                );
                environment = await safePrompt(() =>
                  select({
                    message: "Select environment:",
                    choices: newEnvs.map((e) => ({ name: e, value: e })),
                  })
                );
              }
            }
            if (err.newEnv) {
              environment = err.newEnv;
            }
            continue mainLoop;
          }

          if (err.name !== "ExitPromptError") {
            console.log(
              chalk.red(
                `\n✘ An error occurred in the shell: ${err.message || err}`
              )
            );
          }
          break mainLoop;
        }
      }

      console.log(chalk.blue("\nExiting Redenv Shell. Goodbye!"));
      delete process.env.REDENV_SHELL_ACTIVE;
    });
}