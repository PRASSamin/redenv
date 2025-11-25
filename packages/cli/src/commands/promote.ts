import chalk from "chalk";
import ora, {type Ora } from "ora";
import { Command } from "commander";
import { redis } from "../core/upstash";
import { loadProjectConfig } from "../core/config";
import {
  getAuditUser,
  nameValidator,
  safePrompt,
  writeProjectConfig,
} from "../utils";
import { input } from "@inquirer/prompts";
import dotenv from "dotenv";
import { unlockProject } from "../core/keys";
import { decrypt } from "@redenv/core";
import { multiline } from "@cli-prompts/multiline";
import { writeSecret } from "@redenv/core";

export function promoteCommand(program: Command) {
  program
    .command("promote")
    .description(
      "Promote new or changed variables from a source environment to a destination"
    )
    .option("-t, --to <to>", "Destination environment name", "production")
    .action(async (options) => {
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

      let promotionEnvironment = projectConfig.productionEnvironment || options.to;
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

      let spinner: Ora | undefined;
      try {
        const pek = await unlockProject(projectName);

        spinner = ora(
          `Fetching variables from ${environment} and ${promotionEnvironment}...`
        ).start();

        const devKey = `${environment}:${projectName}`;
        const prodKey = `${promotionEnvironment}:${projectName}`;

        const [devVars, prodVars] = await Promise.all([
          redis.hgetall<Record<string, any>>(devKey),
          redis.hgetall<Record<string, any>>(prodKey),
        ]);
        spinner.stop();

        if (!devVars || Object.keys(devVars).length === 0) {
          console.log(
            chalk.yellow(
              `No variables found in source environment "${environment}".`
            )
          );
          return;
        }

        spinner.start("Comparing environments and decrypting values...");
        const devKeys = Object.keys(devVars);
        const prodKeys = Object.keys(prodVars ?? {});
        const keysToPromote: string[] = [];

        // Find keys in dev that are not in prod
        for (const key of devKeys) {
          if (!prodKeys.includes(key)) {
            keysToPromote.push(key);
          }
        }

        // Find keys that are in both but have different values
        const conflictingKeys = devKeys.filter((k) => prodKeys.includes(k));
        const decryptAndComparePromises = conflictingKeys.map(async (key) => {
          try {
            const devHistory = devVars[key];
            const prodHistory = prodVars?.[key];
            if (!Array.isArray(devHistory) || devHistory.length === 0) return;
            if (!Array.isArray(prodHistory) || prodHistory.length === 0) return;

            const devValue = await decrypt(devHistory[0].value, pek);
            const prodValue = await decrypt(prodHistory[0].value, pek);

            if (devValue !== prodValue) {
              keysToPromote.push(key);
            }
          } catch {
            // Ignore
          }
        });
        await Promise.all(decryptAndComparePromises);

        if (keysToPromote.length === 0) {
          spinner.succeed(
            chalk.green(
              `No new or changed keys to promote. ${promotionEnvironment} is already in sync.`
            )
          );
          return;
        }
        spinner.succeed("Found new/changed keys.");

        const decryptedKeysToPromote: Record<string, string> = {};
        for (const key of keysToPromote) {
          try {
            const history = devVars[key];
            if (!Array.isArray(history) || history.length === 0)
              throw new Error();
            decryptedKeysToPromote[key] = await decrypt(history[0].value, pek);
          } catch {
            decryptedKeysToPromote[key] = "[redenv: could not decrypt]";
          }
        }

        const envContent = Object.entries(decryptedKeysToPromote)
          .map(([k, v]) => `${k}="${v}"`)
          .join("\n");

        console.log(
          chalk.cyan(
            `\n📝 Review and edit the variables to be promoted to ${chalk.yellow(
              promotionEnvironment
            )}:\n`
          )
        );

        const updatedValues = await safePrompt(() =>
          multiline({
            prompt: "Review and edit the variables to be promoted:",
            required: true,
            spinner: true,
            default: envContent,
            validate: (v) =>
              v.trim().length > 0 || "Cannot promote empty values.",
          })
        );

        const updatedVars = dotenv.parse(updatedValues);

        const finalVarsToPromote = Object.fromEntries(
          Object.entries(updatedVars).filter(([k]) => keysToPromote.includes(k))
        );

        if (Object.keys(finalVarsToPromote).length === 0) {
          console.log(chalk.yellow("No variables to promote after editing."));
          return;
        }

        spinner.start(
          `Encrypting and promoting ${
            Object.keys(finalVarsToPromote).length
          } variable(s) to ${promotionEnvironment}...`
        );

        const writePromises = Object.entries(finalVarsToPromote).map(
          ([key, value]) => {
            return writeSecret(
              redis,
              projectName,
              promotionEnvironment,
              key,
              value,
              pek,
              getAuditUser()
            );
          }
        );
        await Promise.all(writePromises);

        spinner.succeed(
          chalk.greenBright(
            `New keys promoted to ${promotionEnvironment} successfully!`
          )
        );
      } catch (err) {
        const error = err as Error;
        if (spinner && spinner.isSpinning) {
          spinner.fail(chalk.red(error.message));
        } else if (error.name !== "ExitPromptError") {
          console.log(
            chalk.red(`\n✘ An unexpected error occurred: ${error.message}`)
          );
        }
        process.exit(1);
      }
    });
}
