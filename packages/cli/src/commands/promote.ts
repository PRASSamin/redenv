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

      const projectName = projectConfig?.name;

      let environment = projectConfig?.environment;
      if (projectConfig && !environment) {
        environment = "development";
        writeProjectConfig({
          environment,
        });
      }

      const devKey = `${environment}:${projectName}`;

      let promotionEnvironment = projectConfig?.productionEnvironment;
      if (!projectConfig?.productionEnvironment) {
        promotionEnvironment = await safePrompt(() =>
          input({
            message: "Enter promotion environment name:",
            required: true,
            validate: nameValidator,
          })
        );
        writeProjectConfig({
          productionEnvironment: promotionEnvironment,
        });
      }
      const prodKey = `${promotionEnvironment}:${projectName}`;

      const spinner = ora(
        `Fetching variables from ${environment} and ${promotionEnvironment}...`
      ).start();
      try {
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

        // Filter dev keys that are not yet in prod
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

        // Create temp .env file for editing
        const tempFile = path.join(
          os.tmpdir(),
          `redenv-${projectName}-promote.env`
        );
        const envContent = Object.entries(newKeys)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n");

        fs.writeFileSync(tempFile, envContent, "utf8");
        console.log(
          chalk.cyan(
            `📝 Loaded ${Object.keys(newKeys).length} new keys for editing.`
          )
        );

        // Open in editor
        const editor = process.env.EDITOR || "nano";
        try {
          execSync(`${editor} "${tempFile}"`, { stdio: "inherit" });
        } catch {
          console.log(chalk.gray("Editor closed or interrupted."));
        }

        // Read updated file
        const updatedContent = fs.readFileSync(tempFile, "utf8");
        const updatedVars = dotenv.parse(updatedContent);

        // Filter to only include keys that were originally new
        const originalNewKeys = Object.keys(newKeys);
        const finalVarsToPromote = Object.fromEntries(
          Object.entries(updatedVars).filter(([k]) => originalNewKeys.includes(k))
        );

        const uploadSpinner = ora(`Promoting new variables to prod...`).start();
        await redis.hset(prodKey, finalVarsToPromote);
        uploadSpinner.succeed(
          chalk.greenBright(`New keys promoted to prod successfully!`)
        );

        fs.unlinkSync(tempFile); // clean temp file
      } catch (err) {
        spinner.fail(chalk.red(`Failed: ${(err as Error).message}`));
      }
    });
}
