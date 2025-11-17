import chalk from "chalk";
import ora from "ora";
import { Command } from "commander";
import { redis } from "../core/upstash";
import { select, checkbox, input } from "@inquirer/prompts";
import { loadProjectConfig } from "../core/config";
import { nameValidator, safePrompt, sanitizeName } from "../utils";
import { fetchEnvironments, fetchProjects } from "../utils/redis";
import { unlockProject } from "../core/keys";
import { decrypt } from "../core/crypto";

export function cloneCommand(program: Command) {
  program
    .command("clone")
    .argument("[key]", "Clone only a specific key (optional)")
    .description("Clone environment variables from one environment to another")
    .option("-f, --from <env>", "Source environment")
    .option("-t, --to <env>", "Destination environment")
    .option("-p, --project <name>", "Project name")
    .option("--skip-config", "Ignore local project config file")
    .action(async (keyArg, options) => {
      let { from, to } = options;
      let project = sanitizeName(options.project);
      from = sanitizeName(from);
      to = sanitizeName(to);

      let config = options.project ? null : loadProjectConfig();
      project = project || config?.name;

      if (!project) {
        const projects = await fetchProjects();
        if (projects.length === 0) {
          console.log(chalk.red("✘ No projects found in Redis."));
          return;
        }
        project = await safePrompt(() =>
          select({
            message: "Select project:",
            choices: projects.map((p) => ({ name: p, value: p })),
          })
        );
      }

      const pek = await unlockProject(project);

      const envs = (await fetchEnvironments(project)) || [];
      if (!envs.length || envs.length === 0) {
        console.log(chalk.red('✘ No environments found for project "' + project + '".'));
        return;
      }

      if (!from) {
        from = await safePrompt(() =>
          select({
            message: "Select source environment:",
            choices: envs.map((e) => ({ name: e, value: e })),
          })
        );
      }

      if (!to) {
        to = await safePrompt(() =>
          select({
            message: "Select destination environment:",
            choices: [...envs.filter((e) => e !== from).map((e) => ({ name: e, value: e })), { name: "New environment", value: "New environment" }],
          })
        );
        if (to === "New environment") {
          to = await safePrompt(() =>
            input({
              required: true,
              message: "Enter new environment name:",
              validate: (input) => {
                if (input === from) return "Environment name cannot be the same as source.";
                return nameValidator(input);
              },
            })
          );
        }
      }

      const sourceKey = `${from}:${project}`;
      const destKey = `${to}:${project}`;
      const spinner = ora("Loading variables...").start();

      let sourceVars: Record<string, any> = {};
      let destVars: Record<string, any> = {};

      try {
        sourceVars = (await redis.hgetall(sourceKey)) || {};
        destVars = (await redis.hgetall(destKey)) || {};
        spinner.stop();
      } catch (err) {
        spinner.fail(chalk.red(`Failed: ${(err as Error).message}`));
        return;
      }

      if (Object.keys(sourceVars).length === 0) {
        console.log(chalk.red("✘ Source environment has no variables."));
        return;
      }

      let missingKeys = Object.keys(sourceVars).filter((k) => !(k in destVars));
      if (missingKeys.length === 0) {
        console.log(chalk.green(`✔ Everything is already synced! No new keys to clone from ${from} → ${to}.`));
        return;
      }

      let selectedKeys: string[] = [];
      if (keyArg) {
        if (!missingKeys.includes(keyArg)) {
          console.log(chalk.yellow(`✘ Key '${keyArg}' already exists in ${to} environment.`));
          return;
        }
        selectedKeys = [keyArg];
      } else {
        selectedKeys = await safePrompt(() =>
          checkbox({
            message: `Select keys to clone into ${to}:`,
            choices: missingKeys.map((k) => ({ name: k, value: k })),
            loop: false,
          })
        );
        if (selectedKeys.length === 0) {
          console.log(chalk.yellow("✘ No keys selected."));
          return;
        }
      }

      const newData: Record<string, any> = {};
      for (const k of selectedKeys) {
        newData[k] = sourceVars[k];
      }

      console.log(chalk.cyan("\nKeys to clone:"));
      for (const k of selectedKeys) {
        try {
          const history = sourceVars[k];
          if (!Array.isArray(history) || history.length === 0) throw new Error();
          const latestValue = decrypt(history[0].value, pek);
          console.log(`  • ${k}=${latestValue}`);
        } catch {
          console.log(`  • ${k}=[could not display value]`);
        }
      }

      const confirm = await safePrompt(() => select({ message: "Proceed?", choices: [{name: "Yes", value: "yes"}, {name: "No", value: "no"}] }));
      if (confirm === "no") {
        console.log(chalk.yellow("✘ Cancelled."));
        return;
      }

      const apply = ora("Cloning...").start();
      try {
        const dataToStore: Record<string, string> = {};
        for(const key in newData) {
            dataToStore[key] = JSON.stringify(newData[key]);
        }
        await redis.hset(destKey, dataToStore);
        apply.succeed(chalk.green(`Successfully cloned ${selectedKeys.length} key(s) from ${from} → ${to}!`));
      } catch (err) {
        apply.fail(chalk.red(`Failed: ${(err as Error).message}`));
      }
    });
}