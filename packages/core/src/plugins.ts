import { z } from "zod";
import type { RedenvPlugin } from "./types";

const PluginSchema = z.object({
  name: z.string().min(1),
  commands: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      action: z.function(),
    })
  ),
});

/**
 * Validates a plugin.
 */
export const validatePlugin = (plugin: unknown) => {
  const result = PluginSchema.safeParse(plugin);

  if (!result.success) {
    const errorMsg = result.error.issues
      .map((e) => `${e.path.join(".")} (${e.message})`)
      .join(", ");

    // Try to salvage a name for the error message
    const name = (plugin as any)?.name || "Unknown Plugin";

    throw new Error(`Broken plugin "${name}": ${errorMsg}`);
  }
};

/**
 * Helper to define a plugin with type inference.
 */
export const createPlugin = (plugin: RedenvPlugin) => {
  validatePlugin(plugin);
  return plugin;
};