import { Command } from "commander";
import { switchEnvCommand } from "./env";
import { switchProjectCommand } from "./project";

export function switchCommand(program: Command) {
  const switchCmd = program
    .command("switch")
    .description(
      "Switch between different environments or switch to a different project"
    );

  switchEnvCommand(switchCmd);
  switchProjectCommand(switchCmd);
}
