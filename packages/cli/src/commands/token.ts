import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../core/config";
import { safePrompt, sanitizeName } from "../utils";
import { fetchProjects } from "../utils/redis";
import { select, input, checkbox, confirm } from "@inquirer/prompts";
import { unlockProject } from "../core/keys";
import {
  deriveKey,
  encrypt,
  generateSalt,
  exportKey,
  randomBytes,
} from "@redenv/core";
import { redis } from "../core/upstash";
import ora, { type Ora } from "ora";
import Table from "cli-table3";

// Generates a random, URL-safe string
const generateRandomString = (length: number) => {
  return randomBytes(length).toString().slice(0, length);
};

// Helper to safely parse the serviceTokens field
const parseServiceTokens = (metadata: Record<string, any> | null) => {
  if (!metadata || !metadata.serviceTokens) {
    return {};
  }
  return typeof metadata.serviceTokens === "string"
    ? JSON.parse(metadata.serviceTokens)
    : metadata.serviceTokens;
};

export function tokenCommand(program: Command) {
  const tokenCmd = program
    .command("token")
    .description("Manage Service Tokens for your projects");

  // --- token create ---
  tokenCmd
    .command("create")
    .argument("[project]", "The project to create a token for")
    .option("-n, --name <name>", "A name for the token")
    .option("-d, --description <text>", "A description for the token")
    .description("Create a new Service Token to grant access to an application")
    .action(async (project, options) => {
      let projectName = sanitizeName(project) || loadProjectConfig()?.name;

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
        const pek = await unlockProject(projectName);
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
        } else if (error.name !== "ExitPromptError") {
          console.log(
            chalk.red(`\n✘ An unexpected error occurred: ${error.message}`)
          );
        }
        process.exit(1);
      }
    });

  // --- token list ---
  tokenCmd
    .command("list")
    .argument("[project]", "The project to list tokens for")
    .description("List all active Service Tokens for a project")
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
            message: "Select project to list tokens for:",
            choices: projects.map((p) => ({ name: p, value: p })),
          })
        );
      }

      const spinner = ora("Fetching tokens...").start();
      try {
        const metaKey = `meta@${projectName}`;
        const metadata = await redis.hgetall<Record<string, any>>(metaKey);

        const serviceTokens = parseServiceTokens(metadata);
        const tokenIds = Object.keys(serviceTokens);

        if (tokenIds.length === 0) {
          spinner.info(`No Service Tokens found for project "${projectName}".`);
          return;
        }
        spinner.succeed(
          `Found ${tokenIds.length} Service Token(s) for project "${projectName}".`
        );

        const table = new Table({
          head: ["Name", "Description", "Token ID", "Created At"],
          colWidths: [20, 30, 22, 30],
        });

        tokenIds.forEach((id) => {
          const token = serviceTokens[id];
          table.push([
            token.name,
            token.description,
            id,
            new Date(token.createdAt).toLocaleString(),
          ]);
        });
        console.log(table.toString());
      } catch (err) {
        spinner.fail(chalk.red((err as Error).message));
        process.exit(1);
      }
    });

  // --- token revoke ---
  tokenCmd
    .command("revoke")
    .argument("[project]", "The project to revoke a token from")
    .argument("[token-ids...]", "The ID(s) of the token to revoke")
    .description("Revoke a Service Token to remove an application's access")
    .action(async (project, tokenIds) => {
      let projectName = sanitizeName(project) || loadProjectConfig()?.name;

      if (!projectName) {
        const projects = await fetchProjects();
        if (projects.length === 0) {
          console.log(chalk.red("✘ No projects found."));
          return;
        }
        projectName = await safePrompt(() =>
          select({
            message: "Select project:",
            choices: projects.map((p) => ({ name: p, value: p })),
          })
        );
      }

      const spinner = ora("Fetching tokens...").start();
      try {
        const metaKey = `meta@${projectName}`;
        const metadata = await redis.hgetall<Record<string, any>>(metaKey);

        const serviceTokens = parseServiceTokens(metadata);
        let tokenIdsToRevoke: string[] = tokenIds;

        if (tokenIdsToRevoke.length === 0) {
          const tokenChoices = Object.keys(serviceTokens).map((id) => ({
            name: `${serviceTokens[id].name} (${id})`,
            value: id,
          }));
          if (tokenChoices.length === 0) {
            spinner.info(
              `No Service Tokens to revoke for project "${projectName}".`
            );
            return;
          }
          spinner.stop();
          tokenIdsToRevoke = await safePrompt(() =>
            checkbox({
              message: "Select token(s) to revoke:",
              choices: tokenChoices,
              validate: (c) => c.length > 0 || "Select at least one token.",
            })
          );
        }

        if (tokenIdsToRevoke.length === 0) {
          console.log(chalk.yellow("No tokens selected."));
          return;
        }

        spinner.stop();
        const confirmation = await safePrompt(() =>
          confirm({
            message: `Are you sure you want to revoke ${tokenIdsToRevoke.length} token(s)? Any application using them will immediately lose access.`,
            default: false,
          })
        );

        if (!confirmation) {
          console.log(chalk.yellow("✘ Revocation cancelled."));
          return;
        }

        spinner.start("Revoking token(s)...");
        tokenIdsToRevoke.forEach((id) => {
          if (serviceTokens[id]) {
            delete serviceTokens[id];
          }
        });
        await redis.hset(metaKey, {
          serviceTokens: JSON.stringify(serviceTokens),
        });

        spinner.succeed(
          `Successfully revoked ${tokenIdsToRevoke.length} token(s).`
        );
      } catch (err) {
        if (spinner.isSpinning) spinner.fail(chalk.red((err as Error).message));
        else if ((err as Error).name !== "ExitPromptError") {
          console.log(
            chalk.red(
              `\n✘ An unexpected error occurred: ${(err as Error).message}`
            )
          );
        }
        process.exit(1);
      }
    });
}
