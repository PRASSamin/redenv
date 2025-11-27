import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../../core/config";
import { safePrompt, sanitizeName } from "../../utils";
import { fetchProjects } from "../../utils/redis";
import { select, input } from "@inquirer/prompts";
import { unlockProject } from "../../core/keys";
import {
  deriveKey,
  encrypt,
  generateSalt,
  exportKey,
  randomBytes,
} from "@redenv/core";
import { redis } from "../../core/upstash";
import ora, { type Ora } from "ora";
import { parseServiceTokens } from ".";

// Generates a random, URL-safe string
const generateRandomString = (length: number) => {
  return randomBytes(length).toString("base64").slice(0, length);
};

export function createTokenCommand(program: Command) {
  program
    .command("create")
    .argument("[project]", "The project to create a token for")
    .option("-n, --name <name>", "A name for the token")
    .option("-d, --description <text>", "A description for the token")
    .description("Create a new Service Token to grant access to an application")
    .action(action);
}

export const action = async (project: string, options: any) => {
  let projectName =
    sanitizeName(project) || loadProjectConfig()?.name || options.project;

  if (!projectName) {
    const projects = await fetchProjects();
    if (projects.length === 0) {
      console.log(chalk.red("✘ No projects found."));
      return;
    }
    projectName = await safePrompt(() =>
      select({
        message: "Select project to create a token for:",
        choices: projects.map((p) => ({ name: p, value: p })),
      })
    );
  }

  const name =
    options.name ||
    (await safePrompt(() =>
      input({
        message: "Enter a name for this token (e.g., Vercel Production):",
        validate: (n) => n.length > 0 || "Name cannot be empty.",
      })
    ));

  const description =
    options.description ||
    (await safePrompt(() =>
      input({
        message: "Enter a description for this token (optional):",
      })
    ));

  let spinner: Ora | undefined;
  try {
    const pek = options.pek ?? (await unlockProject(projectName as string));
    spinner = ora("Generating and saving token...").start();

    const publicTokenId = `stk_${generateRandomString(16)}`;
    const secretToken = `redenv_sk_${generateRandomString(32)}`;
    const tokenSalt = generateSalt();

    const tokenKey = await deriveKey(secretToken, tokenSalt);
    const exportedPEK = await exportKey(pek);
    const encryptedPEK = await encrypt(exportedPEK, tokenKey);

    const metaKey = `meta@${projectName}`;
    const metadata = await redis.hgetall<Record<string, any>>(metaKey);
    if (!metadata) {
      throw new Error("Failed to retrieve project metadata.");
    }

    const serviceTokens = parseServiceTokens(metadata);

    serviceTokens[publicTokenId] = {
      encryptedPEK,
      salt: Buffer.from(tokenSalt).toString("hex"),
      name,
      description,
      createdAt: new Date().toISOString(),
    };

    await redis.hset(metaKey, {
      serviceTokens: JSON.stringify(serviceTokens),
    });

    spinner.succeed("Service Token created successfully.");

    console.log(
      chalk.yellow(
        "\n┌───────────────────────────────────────────────────────────────────┐"
      )
    );
    console.log(
      chalk.yellow("│ ") +
        chalk.bold.red("IMPORTANT:") +
        " The Secret Token Key is shown " +
        chalk.bold("ONCE") +
        ". Store it securely. │"
    );
    console.log(
      chalk.yellow(
        "└───────────────────────────────────────────────────────────────────┘\n"
      )
    );
    console.log(
      chalk.cyan("  Your application will need these three values:\n")
    );
    console.log(`    ${chalk.bold("Project Name:")}      ${projectName}`);
    console.log(`    ${chalk.bold("Public Token ID:")}   ${publicTokenId}`);
    console.log(
      `    ${chalk.bold("Secret Token Key:")}  ${chalk.green(secretToken)}`
    );
  } catch (err) {
    const error = err as Error;
    if (spinner && spinner.isSpinning) {
      spinner.fail(chalk.red(error.message));
    }

    if (process.env.REDENV_SHELL_ACTIVE) {
      throw error;
    }

    if (error.name !== "ExitPromptError") {
      console.log(
        chalk.red(`\n✘ An unexpected error occurred: ${error.message}`)
      );
    }
    process.exit(1);
  }
};
