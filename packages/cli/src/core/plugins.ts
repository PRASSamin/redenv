import { validatePlugin, type ProjectConfig } from "@redenv/core";
import { Command } from "commander";
import chalk from "chalk";
import { redis } from "./upstash";

export function loadPlugins(
  program: Command,
  config: ProjectConfig | undefined
) {
  // Safe check for plugins existence
  if (!config || !config.plugins || !Array.isArray(config.plugins)) {
    return;
  }

  for (const plugin of config.plugins) {
    try {
      validatePlugin(plugin);

      // SET THE VISUAL GROUP
      program.commandsGroup(plugin.name);

      for (const command of plugin.commands) {
        
        // CREATE SUBCOMMAND
        const pluginCmd = program
          .command(command.name)
          .description(command.description);

        const rawArgs = command.args || [];
        const registeredFlags = command.flags || [];

        // --- LOGIC TO ERASE ARGS AFTER VARIADIC ---
        let effectiveArgs = rawArgs;
        const variadicIndex = rawArgs.findIndex((arg) => arg.multiple);

        if (variadicIndex !== -1 && variadicIndex < rawArgs.length - 1) {
          console.warn(
            chalk.yellow(
              `[Warning] Plugin "${plugin.name}" -> Command "${command.name}": Arguments defined after variadic "${rawArgs[variadicIndex]?.name}" were ignored.`
            )
          );
          effectiveArgs = rawArgs.slice(0, variadicIndex + 1);
        }
        // ------------------------------------------

        // Register Arguments
        effectiveArgs.forEach((arg) => {
          const argName = arg.required
            ? `<${arg.name}${arg.multiple ? "..." : ""}>`
            : `[${arg.name}${arg.multiple ? "..." : ""}]`;

          pluginCmd.argument(argName, arg.description, arg.defaultValue);
        });

        // Register Flags
        registeredFlags.forEach((flag) => {
          const short = flag.short ? `-${flag.short}, ` : "";
          const long = `--${flag.name}`;
          const val = ` <${flag.name}>`;

          pluginCmd.option(
            `${short}${long}${val}`,
            flag.description,
            flag.defaultValue
          );
        });

        // Handle Action
        pluginCmd.action(async (...actionArgs: any[]) => {
          // Cleanup Commander internal args
          actionArgs.pop(); // command object
          const opts = actionArgs.pop() as Record<string, any>; // options object

          // Map positional arguments
          const argsObject = effectiveArgs.reduce((acc, arg, index) => {
            acc[arg.name] = actionArgs[index];
            return acc;
          }, {} as Record<string, any>);

          // Execute Plugin Action
          await command.action(argsObject, opts, {
            config,
            redis,
            cwd: process.cwd(),
          });
        });
      }
    } catch (err) {
      console.error(
        chalk.red(
          `Error initializing plugin "${plugin.name || "unknown"}": ${
            (err as Error).message
          }`
        )
      );
    }
  }
}