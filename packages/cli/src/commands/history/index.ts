import { Command } from "commander";
import { historyViewCommand } from "./view";
import { historyLimitCommand } from "./limit";

export function historyCommand(program: Command) {
  const historyCmd = program
    .command("history")
    .description(
      "View the version history of a secret or manage history settings"
    );

  historyViewCommand(historyCmd);
  historyLimitCommand(historyCmd);
}
