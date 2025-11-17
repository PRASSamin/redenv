import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { safePrompt, sanitizeName } from "../utils";
import { fetchProjects } from "../utils/redis";
import { select, password } from "@inquirer/prompts";
import { forgetProjectKey } from "../core/keys";
import { deriveKey, encrypt, decrypt } from "../core/crypto";
import { redis } from "../core/upstash";
import ora from "ora";

export function changePasswordCommand(program: Command) {
  program
    .command("change-password")
    .argument("[project]", "The project for which to change the password")
    .description("Change the Master Password for an encrypted project")
    .action(async (project) => {
      let projectName = sanitizeName(project) || loadProjectConfig()?.name;

      if (!projectName) {
        const projects = await fetchProjects();
        if (projects.length === 0) {
          console.log(chalk.red("✘ No projects found."));
          return;
        }
        projectName = await safePrompt(() =>
          select({
            message: "Select project to change password for:",
            choices: projects.map((p) => ({ name: p, value: p })),
          })
        );
      }

      let spinner;
      try {
        console.log(
          chalk.blue(`Changing Master Password for project "${projectName}".`)
        );

        const currentMasterPassword = await safePrompt(() =>
          password({
            message: "Enter your CURRENT Master Password:",
            mask: "*",
          })
        );

        spinner = ora("Verifying password and unlocking project...").start();
        const metaKey = `meta@${projectName}`;
        const metadata = await redis.hgetall<{
          encryptedPEK: string;
          salt: string;
        }>(metaKey);

        if (!metadata || !metadata.encryptedPEK || !metadata.salt) {
          throw new Error("Could not retrieve project metadata.");
        }

        const salt = Buffer.from(metadata.salt, "hex");
        const passwordDerivedKey = await deriveKey(currentMasterPassword, salt);
        const decryptedPEKHex = decrypt(
          metadata.encryptedPEK,
          passwordDerivedKey
        );
        const pek = Buffer.from(decryptedPEKHex, "hex");
        spinner.succeed("Current password verified.");

        const newMasterPassword = await safePrompt(() =>
          password({
            message: "Enter your NEW Master Password:",
            mask: "*",
            validate: (p) =>
              p.length >= 8 || "Password must be at least 8 characters long.",
          })
        );
        await safePrompt(() =>
          password({
            message: "Confirm your NEW Master Password:",
            mask: "*",
            validate: (value) =>
              value === newMasterPassword || "Passwords do not match.",
          })
        );

        spinner.text = "Re-encrypting project key...";
        spinner.start();

        const newPasswordDerivedKey = await deriveKey(newMasterPassword, salt);
        const newEncryptedPEK = encrypt(
          pek.toString("hex"),
          newPasswordDerivedKey
        );

        await redis.hset(metaKey, { encryptedPEK: newEncryptedPEK });
        await forgetProjectKey(projectName);

        spinner.succeed(
          chalk.green(
            `Successfully changed Master Password for project "${projectName}".`
          )
        );
        console.log(
          chalk.yellow(
            "  Your new password is now in effect. The old password will no longer work."
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
        // Explicitly exit with a failure code to ensure the spinner process is killed.
        process.exit(1);
      }
    });
}
