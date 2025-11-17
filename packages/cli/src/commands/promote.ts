import chalk from "chalk";
import ora, { Ora } from "ora";
import { Command } from "commander";
import { redis } from "../core/upstash";
import { loadProjectConfig } from "../core/config";
import { nameValidator, safePrompt, writeProjectConfig } from "../utils";
import { input } from "@inquirer/prompts";
import dotenv from "dotenv";
import { unlockProject } from "../core/keys";
import { decrypt } from "../core/crypto";
import { multiline } from "@cli-prompts/multiline";
import { writeSecret } from "../utils/redis";

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
            const history = newKeys[key];
            if (!Array.isArray(history) || history.length === 0)
              throw new Error();
            decryptedNewKeys[key] = decrypt(history[0].value, pek);
          } catch {
            decryptedNewKeys[key] = "[redenv: could not decrypt]";
          }
        }
        spinner.stop();

        const envContent = Object.entries(decryptedNewKeys)
          .map(([k, v]) => `${k}="${v}"`)
          .join("\n");

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

        spinner.start(
          `Encrypting and promoting ${
            Object.keys(finalVarsToPromote).length
          } variable(s) to ${promotionEnvironment}...`
        );

        for (const key in finalVarsToPromote) {
          await writeSecret(
            projectName,
            promotionEnvironment,
            key,
            finalVarsToPromote[key],
            pek,
            { isNew: true }
          );
        }

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
