import chalk from "chalk";
import ora from "ora";
import { Command } from "commander";
import { redis } from "../core/upstash";
import { loadProjectConfig } from "../core/config";
import { select, checkbox } from "@inquirer/prompts";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";
import { unlockProject } from "../core/keys";
import { decrypt } from "../core/crypto";

export function diffCommand(program: Command) {
  program
    .command("diff")
    .description("Show differences between any two environments of a project")
    .option("--skip-config", "Ignore project config file")
    .option("-p, --project <name>", "Specify project name")
    .action(async (options) => {
      let projectName = sanitizeName(options.project);
      let config = null;

      if (!options.skipConfig) config = loadProjectConfig();
      if (!projectName && config) projectName = config.name;

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

      const pek = await unlockProject(projectName);

      const environments = (await fetchEnvironments(projectName)) || [];
      if (environments.length < 2) {
        console.log(chalk.red("✘ This project only has one environment. Diff requires at least two."));
        return;
      }

      let selected: string[] = [];
      if (environments.length === 2) {
        selected = environments;
      } else {
        selected = await safePrompt(() =>
          checkbox({
            message: "Pick two environments to compare:",
            choices: environments.map((e) => ({ name: e, value: e })),
            validate: (arr) => arr.length === 2 || "Select exactly two environments",
            required: true,
            loop: false,
          })
        );
      }

      const [envA, envB] = selected;
      const keyA = `${envA}:${projectName}`;
      const keyB = `${envB}:${projectName}`;

      const spinner = ora(`Fetching and decrypting variables...`).start();
      let decryptedVarsA: Record<string, string> = {};
      let decryptedVarsB: Record<string, string> = {};

      try {
        const [varsA, varsB] = await Promise.all([
          redis.hgetall<Record<string, string>>(keyA) ?? {},
          redis.hgetall<Record<string, string>>(keyB) ?? {},
        ]);

        for (const key in varsA) {
          try {
            decryptedVarsA[key] = decrypt(varsA[key], pek);
          } catch {
            decryptedVarsA[key] = `[un-decryptable]`;
          }
        }
        for (const key in varsB) {
          try {
            decryptedVarsB[key] = decrypt(varsB[key], pek);
          } catch {
            decryptedVarsB[key] = `[un-decryptable]`;
          }
        }
        spinner.succeed("Loaded and decrypted both environments");
      } catch (err) {
        spinner.fail(chalk.red(`Failed: ${(err as Error).message}`));
        return;
      }

      const keysA = Object.keys(decryptedVarsA);
      const keysB = Object.keys(decryptedVarsB);
      const allKeys = new Set([...keysA, ...keysB]);

      console.log(`\n🔍 Comparing "${envA}" ↔ "${envB}" for project "${projectName}"\n`);

      const onlyInA: string[] = [];
      const onlyInB: string[] = [];
      const changedKeys: string[] = [];
      const sameKeys: string[] = [];

      for (const key of [...allKeys].sort()) {
        const a = decryptedVarsA[key];
        const b = decryptedVarsB[key];

        if (a === undefined && b !== undefined) onlyInB.push(key);
        else if (a !== undefined && b === undefined) onlyInA.push(key);
        else if (a !== b) changedKeys.push(key);
        else sameKeys.push(key);
      }

      if (onlyInA.length) {
        console.log(chalk.magenta("🔸 Only in " + envA));
        onlyInA.forEach((k) => console.log(`  • ${k}="${chalk.green(decryptedVarsA[k])}"`));
        console.log("");
      }

      if (onlyInB.length) {
        console.log(chalk.blue("🔹 Only in " + envB));
        onlyInB.forEach((k) => console.log(`  • ${k}="${decryptedVarsB[k]}"`));
        console.log("");
      }

      if (changedKeys.length) {
        console.log(chalk.yellow("🟡 Changed"));
        changedKeys.forEach((k) => {
          console.log(chalk.bold(`  • ${k}`));
          console.log(`      ${envA}: ${chalk.red(JSON.stringify(decryptedVarsA[k]))}`);
          console.log(`      ${envB}: ${chalk.green(JSON.stringify(decryptedVarsB[k]))}`);
        });
        console.log("");
      }

      if (sameKeys.length) {
        console.log(chalk.green("🟢 Same"));
        sameKeys.forEach((k) => console.log(`  • ${k}`));
        console.log("");
      }

      console.log(chalk.cyan("✨ Diff complete.\n"));
    });
}
