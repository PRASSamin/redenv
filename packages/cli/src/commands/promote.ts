import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { Command } from "commander";
import { redis } from "../core/upstash";
import { loadProjectConfig } from "../core/config";
import { nameValidator, safePrompt, writeProjectConfig } from "../utils";
import { input } from "@inquirer/prompts";
import dotenv from "dotenv";
import { unlockProject } from "../core/keys";
import { decrypt, encrypt } from "../core/crypto";
import { multiline } from "@cli-prompts/multiline";

export function promoteCommand(program: Command) {
  program
    .command("promote")
    .description(
      "Promote new variables from dev to prod (sync without overwriting existing prod keys)"
    )
    .action(async () => {
      const projectConfig = loadProjectConfig();
      if (!projectConfig) {
        console.log(
          chalk.red("✘ No project registered. Use `redenv register <name>`.")
        );
        return;
      }

      const projectName = projectConfig.name;

      let environment = projectConfig.environment;
      if (!environment) {
        environment = "development";
        writeProjectConfig({ environment });
      }

      let promotionEnvironment = projectConfig.productionEnvironment;
      if (!promotionEnvironment) {
        promotionEnvironment = await safePrompt(() =>
          input({
            message: "Enter promotion environment name:",
            default: "production",
            validate: nameValidator,
          })
        );
        writeProjectConfig({ productionEnvironment: promotionEnvironment });
      }

      try {
        const pek = await unlockProject(projectName);

        const spinner = ora(
          `Fetching variables from ${environment} and ${promotionEnvironment}...`
        ).start();

        const devKey = `${environment}:${projectName}`;
        const prodKey = `${promotionEnvironment}:${projectName}`;

        const [devVars, prodVars] = await Promise.all([
          redis.hgetall<Record<string, string>>(devKey),
          redis.hgetall<Record<string, string>>(prodKey),
        ]);
        spinner.stop();

        if (!devVars || Object.keys(devVars).length === 0) {
          console.log(
            chalk.yellow(`No variables found in ${environment} environment.`)
          );
          return;
        }

        const newKeys = Object.fromEntries(
          Object.entries(devVars).filter(([k]) => !(k in (prodVars || {})))
        );

        if (Object.keys(newKeys).length === 0) {
          console.log(
            chalk.yellow(
              `No new keys to promote. ${promotionEnvironment} is already in sync.`
            )
          );
          return;
        }

        spinner.info("Decrypting new keys for editing...");
        const decryptedNewKeys: Record<string, string> = {};
        for (const key in newKeys) {
          try {
            decryptedNewKeys[key] = decrypt(newKeys[key], pek);
          } catch {
            decryptedNewKeys[key] = "[redenv: could not decrypt]";
          }
        }
        spinner.stop();

        const envContent = Object.entries(decryptedNewKeys)
          .map(([k, v]) => `${k}="${v}"`)
          .join("\n");

        console.log(
          chalk.cyan(`📝 Loaded ${Object.keys(newKeys).length} keys.`)
        );

        const updatedValues = await safePrompt(() =>
          multiline({
            prompt: "Edit values to promote:",
            required: true,
            spinner: true,
            default: envContent,
          })
        );

        const updatedVars = dotenv.parse(updatedValues);

        const originalNewKeys = Object.keys(newKeys);
        const finalVarsToPromote = Object.fromEntries(
          Object.entries(updatedVars).filter(([k]) =>
            originalNewKeys.includes(k)
          )
        );

        if (Object.keys(finalVarsToPromote).length === 0) {
          console.log(chalk.yellow("No variables to promote after editing."));
          return;
        }

        const uploadSpinner = ora(
          `Encrypting and promoting new variables to ${promotionEnvironment}...`
        ).start();
        const encryptedFinalVars: Record<string, string> = {};
        for (const key in finalVarsToPromote) {
          encryptedFinalVars[key] = encrypt(finalVarsToPromote[key], pek);
        }

        await redis.hset(prodKey, encryptedFinalVars);
        uploadSpinner.succeed(
          chalk.greenBright(
            `New keys promoted to ${promotionEnvironment} successfully!`
          )
        );
      } catch (err) {
        // Errors from unlockProject are handled, so this will catch other issues.
        console.log(
          chalk.red(
            `\n✘ An unexpected error occurred: ${(err as Error).message}`
          )
        );
      }
    });
}
