import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadPlugins } from "./plugins";
import { Command } from "commander";
import type { RedenvPlugin, ProjectConfig } from "@redenv/core";

// Mock the upstash module to prevent real network calls or config loading issues during test
vi.mock("./upstash", () => ({
  redis: {},
}));

describe("CLI Plugin Loader", () => {
  let mockProgram: any;
  let mockCommand: any;

  beforeEach(() => {
    // Create a chainable mock for Commander
    mockCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      argument: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    mockProgram = {
      commandsGroup: vi.fn(),
      command: vi.fn(() => mockCommand),
    };
  });

  it("should register a simple plugin command", () => {
    const plugin: RedenvPlugin = {
      name: "simple-plugin",
      commands: [
        {
          name: "hello",
          description: "Say hello",
          action: async () => {},
        },
      ],
    };

    const config: ProjectConfig = {
      name: "test-project",
      plugins: [plugin],
    };

    loadPlugins(mockProgram as unknown as Command, config);

    // Verify group was created
    expect(mockProgram.commandsGroup).toHaveBeenCalledWith("simple-plugin");

    // Verify command was registered
    expect(mockProgram.command).toHaveBeenCalledWith("hello");
    expect(mockCommand.description).toHaveBeenCalledWith("Say hello");
    expect(mockCommand.action).toHaveBeenCalled();
  });

  it("should register arguments and flags correctly", () => {
    const plugin: RedenvPlugin = {
      name: "args-plugin",
      commands: [
        {
          name: "complex",
          description: "Complex command",
          args: [
            { name: "requiredArg", description: "Required", required: true },
            { name: "optionalArg", description: "Optional" },
          ],
          flags: [
            {
              name: "flag",
              description: "A flag",
              short: "f",
              defaultValue: "default",
            },
          ],
          action: async () => {},
        },
      ],
    };

    const config: ProjectConfig = {
      name: "test-project",
      plugins: [plugin],
    };

    loadPlugins(mockProgram as unknown as Command, config);

    // Check arguments
    expect(mockCommand.argument).toHaveBeenCalledWith(
      "<requiredArg>",
      "Required",
      undefined
    );
    expect(mockCommand.argument).toHaveBeenCalledWith(
      "[optionalArg]",
      "Optional",
      undefined
    );

    // Check flags
    expect(mockCommand.option).toHaveBeenCalledWith(
      "-f, --flag <flag>",
      "A flag",
      "default"
    );
  });

  it("should warn when arguments are defined after a variadic argument", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const plugin: RedenvPlugin = {
      name: "bad-args-plugin",
      commands: [
        {
          name: "variadic-test",
          description: "Testing variadic logic",
          args: [
            { name: "rest", description: "Rest args", multiple: true },
            { name: "unreachable", description: "Should be ignored" },
          ],
          action: async () => {},
        },
      ],
    };

    const config: ProjectConfig = {
      name: "test-project",
      plugins: [plugin],
    };

    loadPlugins(mockProgram as unknown as Command, config);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Arguments defined after variadic")
    );

    // Ensure only the variadic arg was registered, and the subsequent one was dropped
    expect(mockCommand.argument).toHaveBeenCalledTimes(1);
    expect(mockCommand.argument).toHaveBeenCalledWith(
      "[rest...]",
      "Rest args",
      undefined
    );

    consoleSpy.mockRestore();
  });

  it("should gracefully handle broken plugins without crashing", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const brokenPlugin = {
      name: "broken",
      // Missing commands array
    } as unknown as RedenvPlugin;

    const config: ProjectConfig = {
      name: "test-project",
      plugins: [brokenPlugin],
    };

    expect(() =>
      loadPlugins(mockProgram as unknown as Command, config)
    ).not.toThrow();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error initializing plugin")
    );

    consoleErrorSpy.mockRestore();
  });
});
