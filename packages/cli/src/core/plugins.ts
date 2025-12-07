import {
  validatePlugin,
  type ProjectConfig,
  deriveKey,
  encrypt,
  generateSalt,
  exportKey,
  randomBytes,
} from "@redenv/core";
import { Command } from "commander";
import chalk from "chalk";
import { redis } from "./upstash";
import { unlockProject } from "../core/keys";
import { parseServiceTokens } from "../commands/token";
import { loadGlobalConfig } from "./config";

// In-memory cache for ephemeral tokens to avoid regenerating them in the same process
const ephemeralTokenCache = new Map<
  string,
  { tokenId: string; token: string }
>();

// Register a global exit handler once to clean up ALL ephemeral tokens
const tokensToCleanup: { projectName: string; tokenId: string }[] = [];

// Hook into signals for async cleanup
["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
  process.on(signal, async () => {
    if (tokensToCleanup.length > 0) {
      console.log(
        chalk.dim(`\n[REDENV] Cleaning up temporary access tokens...`)
      );

      for (const { projectName, tokenId } of tokensToCleanup) {
        try {
          const metaKey = `meta@${projectName}`;
          // We need to fetch, parse, remove, and save.
          // This is race-condition prone but acceptable for cleanup.
          const metadata = await redis.hgetall<Record<string, any>>(metaKey);
          if (metadata) {
            const tokens = parseServiceTokens(metadata);
            if (tokens[tokenId]) {
              delete tokens[tokenId];
              await redis.hset(metaKey, {
                serviceTokens: JSON.stringify(tokens),
              });
            }
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    }
    process.exit(0);
  });
});

export function loadPlugins(
  program: Command,
  config: ProjectConfig | undefined
) {
  // Safe check for plugins existence
  if (!config || !config.plugins || !Array.isArray(config.plugins)) {
    return;
  }

  for (const plugin of config.plugins) {
    try {
      validatePlugin(plugin);

      // SET THE VISUAL GROUP
      program.commandsGroup(plugin.name);

      for (const command of plugin.commands) {
        // CREATE SUBCOMMAND
        const pluginCmd = program
          .command(command.name)
          .description(command.description);

        const rawArgs = command.args || [];
        const registeredFlags = command.flags || [];

        // --- LOGIC TO ERASE ARGS AFTER VARIADIC ---
        let effectiveArgs = rawArgs;
        const variadicIndex = rawArgs.findIndex((arg) => arg.multiple);

        if (variadicIndex !== -1 && variadicIndex < rawArgs.length - 1) {
          console.warn(
            chalk.yellow(
              `[Warning] Plugin "${plugin.name}" -> Command "${command.name}": Arguments defined after variadic "${rawArgs[variadicIndex]?.name}" were ignored.`
            )
          );
          effectiveArgs = rawArgs.slice(0, variadicIndex + 1);
        }
        // ------------------------------------------

        // Register Arguments
        effectiveArgs.forEach((arg) => {
          const argName = arg.required
            ? `<${arg.name}${arg.multiple ? "..." : ""}>`
            : `[${arg.name}${arg.multiple ? "..." : ""}]`;

          pluginCmd.argument(argName, arg.description, arg.defaultValue);
        });

        // Register Flags
        registeredFlags.forEach((flag) => {
          const short = flag.short ? `-${flag.short}, ` : "";
          const long = `--${flag.name}`;
          const val = ` <${flag.name}>`;

          pluginCmd.option(
            `${short}${long}${val}`,
            flag.description,
            flag.defaultValue
          );
        });

        // Handle Action
        pluginCmd.action(async (...actionArgs: any[]) => {
          // Cleanup Commander internal args
          actionArgs.pop(); // command object
          const opts = actionArgs.pop() as Record<string, any>; // options object

          // Map positional arguments
          const argsObject = effectiveArgs.reduce((acc, arg, index) => {
            acc[arg.name] = actionArgs[index];
            return acc;
          }, {} as Record<string, any>);

          // --- Ephemeral Token Logic ---
          const getEphemeralToken = async () => {
            const cacheKey = `${config.name}:${plugin.name}`;
            if (ephemeralTokenCache.has(cacheKey)) {
              return ephemeralTokenCache.get(cacheKey)!;
            }
            
            // 1. Unlock Project (User Interaction)
            const pek = await unlockProject(config.name);
            
            // 2. Generate Token
            const randomStr = (len: number) =>
              randomBytes(len).toString("base64").slice(0, len);
            const tokenId = `stk_ephemeral_${plugin.name}_${randomStr(8)}`;
            const tokenSecret = `redenv_sk_${randomStr(32)}`;

            const salt = generateSalt();
            const tokenKey = await deriveKey(tokenSecret, salt);
            const exportedPEK = await exportKey(pek);
            const encryptedPEK = await encrypt(exportedPEK, tokenKey);

            // Save to Redis
            const metaKey = `meta@${config.name}`;
            const metadata = await redis.hgetall<Record<string, any>>(metaKey);
            const tokens = parseServiceTokens(metadata);

            tokens[tokenId] = {
              encryptedPEK,
              salt: Buffer.from(salt).toString("hex"),
              name: `Ephemeral (${plugin.name})`,
              description: "Temporary access token for plugin session",
              createdAt: new Date().toISOString(),
              expiresAt: Date.now() + 60 * 60 * 6 * 1000, // 6 hours expiry as fallback
              ephemeral: true,
            };

            await redis.hset(metaKey, {
              serviceTokens: JSON.stringify(tokens),
            });

            // 4. Register for Cleanup
            tokensToCleanup.push({ projectName: config.name, tokenId });

            const creds = { tokenId, token: tokenSecret };
            ephemeralTokenCache.set(cacheKey, creds);
            return creds;
          };

          // Load Global Config to get Redis credentials
          const globalConfig = loadGlobalConfig();

          // Execute Plugin Action
          await command.action(argsObject, opts, {
            config,
            redis,
            cwd: process.cwd(),
            getEphemeralToken,
            redisUrl: globalConfig.url,
            redisToken: globalConfig.token,
          });
        });
      }
    } catch (err) {
      console.error(
        chalk.red(
          `Error initializing plugin "${plugin.name || "unknown"}": ${
            (err as Error).message
          }`
        )
      );
    }
  }
}