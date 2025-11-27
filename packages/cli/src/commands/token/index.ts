import { Command } from "commander";
import { createTokenCommand } from "./create";
import { listTokenCommand } from "./list";
import { revokeTokenCommand } from "./revoke";

// Helper to safely parse the serviceTokens field
export const parseServiceTokens = (metadata: Record<string, any> | null) => {
  if (!metadata || !metadata.serviceTokens) {
    return {};
  }
  return typeof metadata.serviceTokens === "string"
    ? JSON.parse(metadata.serviceTokens)
    : metadata.serviceTokens;
};

export function tokenCommand(program: Command) {
  const tokenCmd = program
    .command("token")
    .description("Manage Service Tokens for your projects");

  createTokenCommand(tokenCmd);
  listTokenCommand(tokenCmd);
  revokeTokenCommand(tokenCmd);
}
