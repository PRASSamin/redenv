import type { ProjectConfig } from "./types";

export function defineConfig(config: ProjectConfig): ProjectConfig {
  return {
    environment: config.environment || "development",
    ...config,
  };
}
