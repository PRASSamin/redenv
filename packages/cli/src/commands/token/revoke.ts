import chalk from "chalk";
import { Command } from "commander";
import { loadProjectConfig } from "../../core/config";
import { safePrompt, sanitizeName } from "../../utils";
import { fetchProjects } from "../../utils/redis";
import { checkbox, confirm, select } from "@inquirer/prompts";
import { redis } from "../../core/upstash";
import ora from "ora";
import { parseServiceTokens } from ".";

export function revokeTokenCommand(program: Command) {
  program
    .command("revoke")
    .argument("[project]", "The project to revoke a token from")
    .argument("[token-ids...]", "The ID(s) of the token to revoke")
    .description("Revoke a Service Token to remove an application's access")
    .action(action);
}

export const action = async (project: string, tokenIds: string[], options: any) => {
      let projectName = sanitizeName(project) || loadProjectConfig()?.name || options.project;

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
        const error = err as Error;
        if (spinner.isSpinning) spinner.fail(chalk.red((err as Error).message));
        
        if (process.env.REDENV_SHELL_ACTIVE) {
          throw error;
        }

        if ((err as Error).name !== "ExitPromptError") {
          console.log(
            chalk.red(
              `\n✘ An unexpected error occurred: ${(err as Error).message}`
            )
          );
        }
        process.exit(1);
      }
    }