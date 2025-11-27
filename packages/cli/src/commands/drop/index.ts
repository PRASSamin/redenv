import { Command } from "commander";
import { dropEnvCommand } from "./env";
import { dropProjectCommand } from "./project";

export function dropCommand(program: Command) {
  const dropCmd = program
    .command("drop")
    .description("Drop one or more environments or entire projects");

  dropEnvCommand(dropCmd);
  dropProjectCommand(dropCmd);
}
