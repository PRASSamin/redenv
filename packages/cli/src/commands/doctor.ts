import chalk from "chalk";
import { Command } from "commander";
import fs from "fs";
import ora from "ora";
import {
  GLOBAL_CONFIG_PATH,
  loadGlobalConfig,
  loadProjectConfig,
} from "../core/config";
import { redis } from "../core/upstash";
import { fetchEnvironments } from "../utils/redis";

export function doctorCommand(program: Command) {
  program
    .command("doctor")
    .description("Run a health check on your redenv setup")
    .action(action);
}

export const action = async () => {
      console.log(chalk.cyan.bold("🩺 Running redenv doctor..."));
      let hasError = false;

      // 1. Check Global Config
      const globalConfigSpinner = ora("Checking global configuration...").start();
      let globalConfig;
      if (!fs.existsSync(GLOBAL_CONFIG_PATH)) {
        globalConfigSpinner.fail(
          chalk.red(`Global config not found at ${GLOBAL_CONFIG_PATH}`)
        );
        console.log(chalk.yellow("  Run `redenv setup` to create it."));
        hasError = true;
      } else {
        try {
          globalConfig = loadGlobalConfig();
          globalConfigSpinner.succeed(
            chalk.green(`Global config found at ${GLOBAL_CONFIG_PATH}`)
          );
        } catch (err) {
          globalConfigSpinner.fail(
            chalk.red(`Failed to parse global config: ${(err as Error).message}`)
          );
          hasError = true;
        }
      }

      // 2. Check Redis Connection (only if global config is loaded)
      if (globalConfig) {
        const redisSpinner = ora("Connecting to Redis...").start();
        try {
          const res = await redis.ping();
          if (res === "PONG") {
            redisSpinner.succeed(chalk.green("Redis connection successful"));
          } else {
            redisSpinner.warn(
              chalk.yellow(`Unexpected response from Redis: ${res}`)
            );
          }
        } catch (err) {
          redisSpinner.fail(
            chalk.red(`Redis connection failed: ${(err as Error).message}`)
          );
          hasError = true;
        }
      } else {
        ora(chalk.gray("Skipping Redis connection check.")).stop();
      }

      // 3. Check Local Project Config
      const localConfigSpinner = ora(
        "Checking for local project configuration..."
      ).start();
      const projectConfig = await loadProjectConfig();
      if (!projectConfig) {
        localConfigSpinner.info(
          chalk.blue(
            `No local project config (redenv.config.json) found in this directory.`
          )
        );
      } else {
        localConfigSpinner.succeed(chalk.green("Local project config found"));
        console.log(`  - Project: ${chalk.cyan(projectConfig.name)}`);
        console.log(
          `  - Environment: ${chalk.yellow(projectConfig.environment)}`
        );

        // 4. Check Sync Status (only if local and global config exist)
        if (globalConfig) {
          const syncSpinner = ora("Checking project sync status...").start();
          try {
            const remoteEnvs = await fetchEnvironments(projectConfig.name);
            if (remoteEnvs.includes(projectConfig.environment)) {
              syncSpinner.succeed(
                chalk.green("Local environment is in sync with remote.")
              );
            } else {
              syncSpinner.warn(
                chalk.yellow(
                  `Warning: The local environment "${projectConfig.environment}" does not exist in the remote project.`
                )
              );
              if (remoteEnvs.length > 0) {
                console.log(
                  chalk.gray(
                    `  Available remote environments: ${remoteEnvs.join(", ")}`
                  )
                );
              }
            }
          } catch (err) {
            syncSpinner.fail(
              chalk.red(
                `Failed to fetch remote environments: ${(err as Error).message}`
              )
            );
            hasError = true;
          }
        } else {
          ora(chalk.gray("Skipping project sync check.")).stop();
        }
      }

      // Final summary
      console.log(
        "\n" +
          (hasError
            ? chalk.red.bold("🩺 Doctor finished with errors.")
            : chalk.green.bold(
                "🩺 All checks passed! Your setup is looking healthy."
              ))
      );
    }