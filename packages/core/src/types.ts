import type { Redis } from "@upstash/redis";

export type EnvironmentVariableValue = Array<{
  value: string;
  version: number;
  user: string;
  createdAt: string;
}>;

export interface PluginContext {
  /**
   * The project configuration.
   */
  config: ProjectConfig;
  /**
   * The Redis client instance.
   */
  redis: Redis;
  /**
   * The current working directory.
   */
  cwd: string;
  /**
   * The Redis URL.
   */
  redisUrl: string;
  /**
   * The Redis token.
   */
  redisToken: string;
  /**
   * Generates a temporary Service Token for this plugin.
   * This prompts the user to unlock the project if not already unlocked.
   * The token is saved to Redis and cleaned up automatically when the process exits.
   */
  getEphemeralToken: (options?: {
    projectName?: string;
    /**
     * If `true`, generates a new token even if one is already cached.
     */
    new?: boolean;
  }) => Promise<{ tokenId: string; token: string; expiresAt: Date }>;
}

export interface CommandArgs {
  /**
   * The name of the argument.
   */
  name: string;
  /**
   * The description of the argument.
   */
  description: string;
  /**
   * The default value of the argument.
   */
  defaultValue?: any;
  /**
   * Whether the argument is required.
   */
  required?: boolean;
  /**
   * If `true`, enables "variadic" mode. The argument will capture all remaining
   * input arguments as an array of strings.
   * * @remarks
   * **Constraint:** This MUST be the **last** argument defined in the `args` array.
   * Because variadic arguments greedily consume all remaining inputs, any argument
   * defined *after* a `multiple: true` argument will never be reached.
   */
  multiple?: boolean;
}

export interface CommandFlags {
  /**
   * The name of the flag.
   * @example "flag"
   */
  name: string;
  /**
   * The description of the flag.
   */
  description: string;
  /**
   * The default value of the flag.
   */
  defaultValue?: any;
  /**
   * The short name of the flag.
   * @example "f"
   */
  short?: string;
}

export interface RedenvPlugin {
  /**
   * The name of the plugin.
   * @example "my-plugin" (internal ID)
   */
  name: string;

  /**
   * The version of the plugin.
   */
  version?: string;

  // The Command Configuration
  commands: Array<{
    /**
     * The name of the command.
     * @example "my-command"
     */
    name: string;
    /**
     * The description of the command.
     * @example "This is a command"
     */
    description: string;
    /**
     * The options for the command.
     */
    flags?: Array<CommandFlags>;
    args?: Array<CommandArgs>;
    /**
     * The action to be executed when the command is run.
     * @param args The arguments passed to the command.
     * @param options The options passed to the command.
     * @param context The context of the plugin.
     */
    action: (
      args: Record<string, any>,
      options: Record<string, any>,
      context: PluginContext
    ) => Promise<void>;
  }>;
}

export type ProjectConfig = {
  name: string;
  environment?: string;
  plugins?: RedenvPlugin[];
  [key: string]: any;
};
