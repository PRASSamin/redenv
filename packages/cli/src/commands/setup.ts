import chalk from "chalk";
import { Command } from "commander";
import {
  GLOBAL_CONFIG_PATH,
  loadMemoryConfig,
  saveToMemoryConfig,
  type Credential,
} from "../core/config";
import { input, password, select } from "@inquirer/prompts";
import path from "path";
import fs from "fs";
import { safePrompt } from "../utils";

export function setupCommand(program: Command) {
  program
    .command("setup")
    .description("Setup redenv global config")
    .action(action);
}

export const action = async () => {
  let urlAns: string;
  let tokenAns: string;

  const memory = loadMemoryConfig();

  if (memory.length === 0) {
    // First time run or empty memory
    console.log(chalk.blue("Setting up new Upstash credentials..."));
    urlAns = await safePrompt(() =>
      input({
        message: "Enter your Upstash Redis URL:",
        validate: (i) => (i.startsWith("http") ? true : "Not a valid URL"),
      })
    );
    tokenAns = await safePrompt(() =>
      password({
        message: "Enter your Upstash Redis Token:",
        mask: "*",
        validate: (i) => (i.length > 0 ? true : "Token cannot be empty"),
      })
    );
  } else {
    // Has memory, show select prompt
    const choice: Credential | "new" = await safePrompt(() =>
      select({
        message: "Select Upstash credentials:",
        choices: [
          // @ts-expect-error: Type narrowing issue with union type - handling Credential | "new" union
          ...memory
            .map((mem) => ({
              name: `${mem.url} | ****${mem.token.slice(-4)} | ${new Date(
                mem.createdAt
              ).toLocaleString()}`,
              value: mem,
            }))
            .filter((mem) => mem.name !== undefined && mem.name !== null),
          // @ts-expect-error: Type narrowing issue with union type - handling Credential | "new" union
          { name: "✨ Use new credentials", value: "new" },
        ],
      })
    );

    if (typeof choice === "string" && choice === "new") {
      urlAns = await safePrompt(() =>
        input({
          message: "Enter your new Upstash Redis URL:",
          validate: (i) => (i.startsWith("http") ? true : "Not a valid URL"),
        })
      );
      tokenAns = await safePrompt(() =>
        password({
          message: "Enter your new Upstash Redis Token:",
          mask: "*",
          validate: (i) => (i.length > 0 ? true : "Token cannot be empty"),
        })
      );
    } else {
      // User selected existing credentials
      urlAns = choice.url;
      tokenAns = choice.token;
      console.log(chalk.green(`Using saved credentials for ${urlAns}`));
    }
  }

  // Save the chosen/new credentials to memory
  saveToMemoryConfig({
    url: urlAns,
    token: tokenAns,
    createdAt: new Date().toISOString(),
  });

  const email = await safePrompt(() =>
    input({
      message: "Please enter your email for auditing purposes:",
      validate: (val) =>
        val.includes("@") ? true : "Please enter a valid email.",
    })
  );

  // Save to global config
  const data = {
    url: urlAns,
    token: tokenAns,
    email: email,
    createdAt: new Date().toISOString(),
  };

  const configDir = path.dirname(GLOBAL_CONFIG_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(data, null, 2));
  console.log(chalk.green("\n✔ Global config saved successfully!"));
};
