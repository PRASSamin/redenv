import { describe, it, expect } from "vitest";
import { validatePlugin } from "./plugins";
import type { RedenvPlugin } from "./types";

describe("Plugin Validation", () => {
  it("should accept a valid plugin", () => {
    const validPlugin: RedenvPlugin = {
      name: "test-plugin",
      version: "1.0.0",
      commands: [
        {
          name: "test-command",
          description: "A test command",
          action: async () => {},
        },
      ],
    };

    expect(() => validatePlugin(validPlugin)).not.toThrow();
  });

  it("should accept a valid plugin with flags and args", () => {
    const complexPlugin: RedenvPlugin = {
      name: "complex-plugin",
      commands: [
        {
          name: "greet",
          description: "Greets a user",
          args: [{ name: "name", description: "User name", required: true }],
          flags: [{ name: "loud", description: "Say it loudly", short: "l" }],
          action: async () => {},
        },
      ],
    };

    expect(() => validatePlugin(complexPlugin)).not.toThrow();
  });

  it("should throw an error if the plugin name is missing", () => {
    const invalidPlugin = {
      version: "1.0.0",
      commands: [],
    };

    expect(() => validatePlugin(invalidPlugin)).toThrow(/name/);
  });

  it("should throw an error if commands array is missing", () => {
    const invalidPlugin = {
      name: "no-commands-plugin",
    };

    expect(() => validatePlugin(invalidPlugin)).toThrow(/commands/);
  });

  it("should throw an error if a command is missing required fields", () => {
    const invalidPlugin = {
      name: "broken-command-plugin",
      commands: [
        {
          name: "broken",
          // missing description
          action: async () => {},
        },
      ],
    };

    expect(() => validatePlugin(invalidPlugin)).toThrow(/commands/);
  });

  it("should throw an error if action is not a function", () => {
    const invalidPlugin = {
      name: "bad-action-plugin",
      commands: [
        {
          name: "bad-action",
          description: "Bad action",
          action: "not-a-function",
        },
      ],
    };

    expect(() => validatePlugin(invalidPlugin)).toThrow(/commands/);
  });
});
