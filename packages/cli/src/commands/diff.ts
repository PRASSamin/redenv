import chalk from "chalk";
import ora from "ora";
import { Command } from "commander";
import { redis } from "../core/upstash";
import { loadProjectConfig } from "../core/config";
import { select, checkbox } from "@inquirer/prompts";
import { safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";

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

      // If still no project, ask user
      if (!projectName) {
        const projects = await fetchProjects();

        if (projects.length === 0) {
          console.log(chalk.red("✘ No projects found in Redis."));
          return;
        }

        projectName = await safePrompt(() =>
          select({
            message: "Select project:",
            choices: projects,
          })
        );
      }

      const enviornments = (await fetchEnvironments(projectName || "")) || [];

      if (enviornments.length < 2) {
        console.log(
          chalk.red("✘ Only one environment found. Need at least 2.")
        );
        return;
      }

      let selected = [];

      // Auto pick if exactly 2
      if (enviornments.length === 2) {
        selected = enviornments;
      } else {
        selected = await checkbox({
          message: "Pick two environments to compare:",
          choices: enviornments,
          validate: (arr) =>
            arr.length === 2 ? true : "Select exactly two environments",
          required: true,
          loop: false,
        });
      }

      const [envA, envB] = selected;

      const keyA = `${envA}:${projectName}`;
      const keyB = `${envB}:${projectName}`;

      const spinner2 = ora(`Fetching ${envA} & ${envB}...`).start();

      let varsA = {};
      let varsB = {};

      try {
        varsA = (await redis.hgetall(keyA)) ?? {};
        varsB = (await redis.hgetall(keyB)) ?? {};
        spinner2.succeed("Loaded both environments");
      } catch (err) {
        spinner2.fail(chalk.red(`Failed: ${(err as Error).message}`));
        return;
      }

      const keysA = Object.keys(varsA);
      const keysB = Object.keys(varsB);

      const allKeys = new Set([...keysA, ...keysB]);

      console.log("");
      console.log(
        chalk.cyan(
          `🔍 Comparing "${envA}" ↔ "${envB}" for project "${projectName}"`
        )
      );
      console.log("");

      const onlyInA: string[] = [];
      const onlyInB: string[] = [];
      const changedKeys: string[] = [];
      const sameKeys: string[] = [];

      for (const key of [...allKeys].sort()) {
        const a = varsA[key as keyof typeof varsA];
        const b = varsB[key as keyof typeof varsB];

        if (a === undefined && b !== undefined) {
          onlyInB.push(key);
        } else if (a !== undefined && b === undefined) {
          onlyInA.push(key);
        } else if (a !== b) {
          changedKeys.push(key);
        } else {
          sameKeys.push(key);
        }
      }

      if (onlyInA.length) {
        console.log(chalk.magenta("🔸 Only in " + envA));
        onlyInA.forEach((k) =>
          console.log(
            `  • ${k}="${chalk.green(varsA[k as keyof typeof varsA])}"`
          )
        );
        console.log("");
      }

      if (onlyInB.length) {
        console.log(chalk.blue("🔹 Only in " + envB));
        onlyInB.forEach((k) =>
          console.log(`  • ${k}="${varsB[k as keyof typeof varsB]}"`)
        );
        console.log("");
      }

      if (changedKeys.length) {
        console.log(chalk.yellow("🟡 Changed"));
        changedKeys.forEach((k) => {
          console.log(chalk.bold(`  • ${k}`));
          console.log(
            `      ${envA}: ${chalk.red(
              JSON.stringify(varsA[k as keyof typeof varsA])
            )}`
          );
          console.log(
            `      ${envB}: ${chalk.green(
              JSON.stringify(varsB[k as keyof typeof varsB])
            )}`
          );
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
