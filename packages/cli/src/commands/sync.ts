import chalk from "chalk";
import ora from "ora";
import { Command } from "commander";
import { redis } from "../core/upstash";
import { loadProjectConfig } from "../core/config";
import { select, checkbox, confirm } from "@inquirer/prompts";
import { getAuditUser, safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";
import { unlockProject } from "../core/keys";
import { decrypt, writeSecret } from "@redenv/core";

export function syncCommand(program: Command) {
  program
    .command("sync")
    .description(
      "Synchronize variables from a source environment to a destination environment"
    )
    .option("-p, --project <name>", "Specify project name")
    .action(action);
}

export const action = async (options: any) => {
  let projectName = sanitizeName(options.project) || loadProjectConfig()?.name;

  if (!projectName) {
    const projects = await fetchProjects();
    if (projects.length === 0) {
      console.log(chalk.red("✘ No projects found in Redis."));
      return;
    }
    projectName = await safePrompt(() =>
      select({
        message: "Select project:",
        choices: projects.map((p) => ({ name: p, value: p })),
      })
    );
  }

  const pek = options.pek ?? (await unlockProject(projectName as string));
  const environments = (await fetchEnvironments(projectName)) || [];

  if (environments.length < 2) {
    console.log(
      chalk.red(
        "✘ This project only has one environment. Sync requires at least two."
      )
    );
    return;
  }

  const sourceEnv = await safePrompt(() =>
    select({
      message: "Select the SOURCE environment:",
      choices: environments.map((e) => ({ name: e, value: e })),
    })
  );

  const destEnv = await safePrompt(() =>
    select({
      message: "Select the DESTINATION environment:",
      choices: environments
        .filter((e) => e !== sourceEnv)
        .map((e) => ({ name: e, value: e })),
    })
  );

  const spinner = ora("Fetching and comparing environments...").start();

  const sourceKey = `${sourceEnv}:${projectName}`;
  const destKey = `${destEnv}:${projectName}`;
  const sourceVars: Record<string, string> = {};
  const destVars: Record<string, string> = {};

  try {
    const [rawSourceVars, rawDestVars] = await Promise.all([
      redis.hgetall<Record<string, any>>(sourceKey),
      redis.hgetall<Record<string, any>>(destKey),
    ]);

    const decryptPromises = [
      ...Object.entries(rawSourceVars ?? {}).map(async ([key, history]) => {
        try {
          if (!Array.isArray(history) || history.length === 0) return;
          sourceVars[key] = await decrypt(history[0].value, pek);
        } catch {
          /* Ignore decryption errors */
        }
      }),
      ...Object.entries(rawDestVars ?? {}).map(async ([key, history]) => {
        try {
          if (!Array.isArray(history) || history.length === 0) return;
          destVars[key] = await decrypt(history[0].value, pek);
        } catch {
          /* Ignore decryption errors */
        }
      }),
    ];
    await Promise.all(decryptPromises);

    spinner.succeed("Environments compared.");
  } catch (err) {
    spinner.fail(chalk.red(`Failed: ${(err as Error).message}`));
    return;
  }

  const allKeys = new Set([
    ...Object.keys(sourceVars),
    ...Object.keys(destVars),
  ]);
  const addedKeys: string[] = [];
  const updatedKeys: Record<string, { from: string; to: string }> = {};
  const removedKeys: string[] = [];

  for (const key of [...allKeys].sort()) {
    const sourceVal = sourceVars[key];
    const destVal = destVars[key];
    if (sourceVal !== undefined && destVal === undefined) {
      addedKeys.push(key);
    } else if (sourceVal === undefined && destVal !== undefined) {
      removedKeys.push(key);
    } else if (sourceVal !== destVal) {
      updatedKeys[key] = { from: destVal!, to: sourceVal! };
    }
  }

  if (
    addedKeys.length === 0 &&
    Object.keys(updatedKeys).length === 0 &&
    removedKeys.length === 0
  ) {
    console.log(
      chalk.green("\n✨ Environments are already in sync. Nothing to do.")
    );
    return;
  }

  console.log(
    `\nChanges to sync from ${chalk.yellow(sourceEnv)} to ${chalk.yellow(
      destEnv
    )}:`
  );

  // --- INTERACTIVE SELECTION ---
  let keysToAdd: string[] = [];
  let keysToUpdate: string[] = [];
  let keysToRemove: string[] = [];

  if (addedKeys.length > 0) {
    keysToAdd = await safePrompt(() =>
      checkbox({
        message: `The following keys will be ADDED to ${destEnv}. Select which to apply:`,
        choices: addedKeys.map((k) => ({
          name: `${k}="${sourceVars[k]}"`,
          value: k,
        })),
        loop: false,
      })
    );
  }

  if (Object.keys(updatedKeys).length > 0) {
    keysToUpdate = await safePrompt(() =>
      checkbox({
        message: `The following keys will be UPDATED in ${destEnv}. Select which to apply:`,
        choices: Object.entries(updatedKeys).map(([k, v]) => ({
          name: `${k}: ${chalk.red(v.from)} ➤ ${chalk.green(v.to)}`,
          value: k,
        })),
        loop: false,
      })
    );
  }

  if (removedKeys.length > 0) {
    keysToRemove = await safePrompt(() =>
      checkbox({
        message: `The following keys will be REMOVED from ${destEnv}. Select which to apply:`,
        choices: removedKeys.map((k) => ({
          name: `${k}="${destVars[k]}"`,
          value: k,
        })),
        loop: false,
      })
    );
  }

  const totalChanges =
    keysToAdd.length + keysToUpdate.length + keysToRemove.length;
  if (totalChanges === 0) {
    console.log(chalk.yellow("\nNo changes selected. Aborting sync."));
    return;
  }

  const finalConfirm = await safePrompt(() =>
    confirm({
      message: `You are about to apply ${totalChanges} change(s) to the ${chalk.yellow(
        destEnv
      )} environment. This can be destructive. Are you sure?`,
      default: false,
    })
  );

  if (!finalConfirm) {
    console.log(chalk.yellow("\nSync cancelled by user."));
    return;
  }

  const syncSpinner = ora(`Applying changes to ${destEnv}...`).start();
  try {
    const user = getAuditUser();

    // Add/Update operations
    const writePromises = [
      ...keysToAdd.map((key) =>
        writeSecret(
          redis,
          projectName,
          destEnv,
          key,
          sourceVars[key] ?? "",
          pek,
          user
        )
      ),
      ...keysToUpdate.map((key) =>
        writeSecret(
          redis,
          projectName,
          destEnv,
          key,
          updatedKeys[key]?.to ?? "",
          pek,
          user
        )
      ),
    ];
    await Promise.all(writePromises);

    // Remove operations
    if (keysToRemove.length > 0) {
      await redis.hdel(destKey, ...keysToRemove);
    }

    syncSpinner.succeed(
      chalk.green(
        `Successfully synced ${totalChanges} change(s) to ${destEnv}.`
      )
    );
  } catch (err) {
    syncSpinner.fail(chalk.red(`Sync failed: ${(err as Error).message}`));
  }
};
