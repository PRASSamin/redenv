import chalk from "chalk";
import { PROJECT_CONFIG_PATH, loadProjectConfig } from "../core/config";
import fs from "fs";
import { Command } from "commander";
import { safePrompt, sanitizeName } from "../utils";
import { password } from "@inquirer/prompts";
import ora from "ora";
import {
  deriveKey,
  encrypt,
  generateRandomKey,
  generateSalt,
} from "../core/crypto";
import { redis } from "../core/upstash";

export function registerCommand(program: Command) {
  program
    .command("register")
    .argument("<project>", "Project name")
    .argument("[env]", "Project environment", "development")
    .argument("[prodEnv]", "Production environment", "production")
    .description("Register a new project for redenv")
    .action(async (project, env, prodEnv) => {
      const sanitizedProject = sanitizeName(project);
      const sanitizedEnv = sanitizeName(env);
      const sanitizedProdEnv = sanitizeName(prodEnv);

      if (
        project !== sanitizedProject ||
        env !== sanitizedEnv ||
        prodEnv !== sanitizedProdEnv
      ) {
        console.log(
          chalk.yellow(
            "Colons (:) are not allowed in names and have been replaced with hyphens (-)."
          )
        );
      }

      const projectConfig = loadProjectConfig();
      if (projectConfig && projectConfig.name === sanitizedProject) {
        console.log(
          chalk.yellow(`Project ${sanitizedProject} is already registered.`)
        );
        return;
      }

      // Get master password
      const masterPassword = await safePrompt(() =>
        password({
          message: `Create a Master Password for project "${sanitizedProject}":`,
          mask: "*",
          validate: (p) =>
            p.length >= 8
              ? true
              : "Password must be at least 8 characters long.",
        })
      );
      const confirmPassword = await safePrompt(() =>
        password({
          message: "Confirm Master Password:",
          mask: "*",
          validate: (value) => {
            if (value !== masterPassword) {
              return "Passwords do not match.";
            }
            return true;
          },
        })
      );

      if (masterPassword !== confirmPassword) {
        console.log(chalk.red("✘ Passwords do not match."));
        return;
      }

      const spinner = ora("Encrypting and registering project...").start();

      try {
        // 1. Generate keys and salt
        const salt = generateSalt();
        const projectEncryptionKey = generateRandomKey(); // PEK
        const passwordDerivedKey = await deriveKey(masterPassword, salt);

        // 2. Encrypt the PEK with the password-derived key
        const encryptedPEK = encrypt(
          projectEncryptionKey.toString("hex"),
          passwordDerivedKey
        );

        // 3. Store metadata in Redis
        const metaKey = `meta@${sanitizedProject}`;
        const metadata = {
          encryptedPEK: encryptedPEK,
          salt: salt.toString("hex"),
          kdf: "scrypt",
          algorithm: "aes-256-gcm",
          createdAt: new Date().toISOString(),
        };

        await redis.hset(metaKey, metadata);

        // 4. Write local config file
        const data = {
          name: sanitizedProject,
          environment: sanitizedEnv,
          productionEnvironment: sanitizedProdEnv,
          createdAt: new Date().toISOString(),
        };
        fs.writeFileSync(PROJECT_CONFIG_PATH, JSON.stringify(data, null, 2));

        spinner.succeed(
          chalk.green(
            `✔ Project "${sanitizedProject}" registered and encrypted successfully!`
          )
        );
        console.log(
          chalk.yellow(
            "  Remember your Master Password. It cannot be recovered."
          )
        );
      } catch (err) {
        spinner.fail(
          chalk.red(`✘ Failed to register project: ${(err as Error).message}`)
        );
      }
    });
}
