import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Redis } from "@upstash/redis";
import * as core from "@redenv/core";
import { getPEK, populateEnv, log, error } from "./index";

// Mock dependencies
vi.mock("@redenv/core");

// Mock the entire @upstash/redis module.
vi.mock("@upstash/redis", () => {
  const MockRedis = vi.fn(); // This will be the mocked constructor
  MockRedis.prototype.hgetall = vi.fn(); // Mock methods on the prototype
  // Add other methods to MockRedis.prototype if they are used
  return { Redis: MockRedis };
});

// Now, 'Redis' itself is a mocked constructor (MockRedis).
// When 'new Redis()' is called, it returns an instance.
// We can then use vi.mocked on the *instance* to get a typed mock.
const RedisMock = Redis as unknown as vi.MockedClass<typeof Redis>; // Cast Redis to its mocked class type

// Create an instance of the mocked Redis.
const mockedRedis = new RedisMock({ url: "mock", token: "mock" });
const mockedCore = core as vi.Mocked<typeof core>;

describe("Client Utils", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getPEK", () => {
    const options = {
      project: "test-project",
      tokenId: "stk_test",
      token: "redenv_sk_test",
    };

    it("should fetch and decrypt the PEK successfully", async () => {
      const mockMetadata = {
        serviceTokens: JSON.stringify({
          [options.tokenId]: {
            salt: "73616c74", // "salt" in hex
            encryptedPEK: "m_ePEK",
          },
        }),
      };
      mockedRedis.hgetall.mockResolvedValue(mockMetadata);
      mockedCore.deriveKey.mockResolvedValue("derived_key" as any);
      mockedCore.decrypt.mockResolvedValue("decrypted_pek_hex");
      mockedCore.importKey.mockResolvedValue("imported_key" as any);
      mockedCore.hexToBuffer.mockImplementation((s) =>
        new TextEncoder().encode(s)
      );

      const pek = await getPEK(mockedRedis, options);

      expect(mockedRedis.hgetall).toHaveBeenCalledWith(
        `meta@${options.project}`
      );
      expect(mockedCore.hexToBuffer).toHaveBeenCalledWith("73616c74");
      expect(mockedCore.deriveKey).toHaveBeenCalledWith(
        options.token,
        expect.any(Uint8Array)
      );
      expect(mockedCore.decrypt).toHaveBeenCalledWith("m_ePEK", "derived_key");
      expect(mockedCore.importKey).toHaveBeenCalledWith("decrypted_pek_hex");
      expect(pek).toBe("imported_key");
    });

    it("should throw an error if project not found", async () => {
      mockedRedis.hgetall.mockResolvedValue(null);
      await expect(getPEK(mockedRedis, options)).rejects.toThrow(
        'Project "test-project" not found.'
      );
    });

    it("should throw an error if token ID is invalid", async () => {
      const mockMetadata = {
        serviceTokens: JSON.stringify({
          stk_another: { salt: "s", encryptedPEK: "e" },
        }),
      };
      mockedRedis.hgetall.mockResolvedValue(mockMetadata);
      await expect(getPEK(mockedRedis, options)).rejects.toThrow(
        "Invalid Redenv Token ID."
      );
    });
  });

  describe("populateEnv", () => {
    const originalProcessEnv = { ...process.env };

    afterEach(() => {
      process.env = originalProcessEnv;
    });

    it("should populate process.env with secrets", async () => {
      const secrets = {
        VAR1: "value1",
        VAR2: "value2",
      };
      process.env = {}; // Clear it for the test

      await populateEnv(secrets, { log: "none" });

      expect(process.env.VAR1).toBe("value1");
      expect(process.env.VAR2).toBe("value2");
    });
  });

  describe("log and error", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    beforeEach(() => {
      logSpy.mockClear();
      errorSpy.mockClear();
    });

    describe("log", () => {
      it('should not log when preference is "none"', () => {
        log("test", "none");
        expect(logSpy).not.toHaveBeenCalled();
      });

      it('should not log low priority messages when preference is "low"', () => {
        log("test", "low", "low");
        expect(logSpy).not.toHaveBeenCalled();
      });

      it('should log high priority messages when preference is "low"', () => {
        log("test", "low", "high");
        expect(logSpy).toHaveBeenCalledWith("[REDENV] test");
      });

      it('should log everything when preference is "high"', () => {
        log("low message", "high", "low");
        expect(logSpy).toHaveBeenCalledWith("[REDENV] low message");
        log("high message", "high", "high");
        expect(logSpy).toHaveBeenCalledWith("[REDENV] high message");
      });
    });

    describe("error", () => {
      it('should not log error when preference is "none"', () => {
        error("test", "none");
        expect(errorSpy).not.toHaveBeenCalled();
      });

      it('should log error when preference is not "none"', () => {
        error("test", "low");
        expect(errorSpy).toHaveBeenCalledWith("[REDENV] Error: test");
        error("test", "high");
        expect(errorSpy).toHaveBeenCalledWith("[REDENV] Error: test");
      });
    });
  });
});
