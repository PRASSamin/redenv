import { cachified } from "@epic-web/cachified";
import type { CacheEntry } from "@epic-web/cachified";
import { Redis } from "@upstash/redis";
import { LRUCache } from "lru-cache";
import type { RedenvOptions } from "./types";
import { fetchAndDecrypt, populateEnv, setSecret, error, log } from "./utils";
import { RedenvError } from "@redenv/core";

// Create a single LRU cache instance to be used for all clients.
const lru = new LRUCache<string, CacheEntry>({ max: 1000 });

/**
 * The main Redenv class used to configure and create clients.
 */
export class Redenv {
  private options: Required<Omit<RedenvOptions, "cache" | "environment">> & {
    environment: string;
    cache: { ttl: number; staleWhileRevalidate: number };
  };
  private redis: Redis;

  constructor({ ...options }: RedenvOptions) {
    this.validateOptions(options);

    this.options = {
      ...options,
      environment: options.environment || "development",
      log: options.log ?? "low",
      cache: {
        ttl: options.cache?.ttl ?? 300,
        staleWhileRevalidate: options.cache?.swr ?? 86400,
      },
    };
    this.redis = new Redis({
      url: options.upstash.url,
      token: options.upstash.token,
    });
  }

  private validateOptions(options: RedenvOptions) {
    const required = ["project", "tokenId", "token", "upstash"];
    const missing = required.filter(
      (key) => !options[key as keyof RedenvOptions]
    );
    if (!options.upstash?.url || !options.upstash?.token) {
      missing.push("upstash.url", "upstash.token");
    }

    if (missing.length > 0) {
      const errorMessage = `[REDENV] Missing required configuration options: ${missing.join(
        ", "
      )}`;
      throw new RedenvError(errorMessage, "MISSING_CONFIG");
    }
  }

  private getCacheKey(): string {
    return `redenv:${this.options.project}:${this.options.environment}`;
  }

  private getSecrets(): Promise<Record<string, string>> {
    return cachified({
      key: this.getCacheKey(),
      cache: lru,
      getFreshValue: async () => {
        const secrets = await fetchAndDecrypt(this.redis, this.options);
        await populateEnv(secrets, this.options);
        return secrets;
      },
      ttl: this.options.cache.ttl * 1000,
      staleWhileRevalidate: this.options.cache.staleWhileRevalidate * 1000,
    });
  }

  /**
   * Initializes the environment with secrets.
   */
  public async init(): Promise<void> {
    await this.load();
  }

  /**
   * Fetches, caches, and injects secrets into the environment.
   * Returns a client instance for optional programmatic access.
   */
  public async load(): Promise<Record<string, string>> {
    const secrets = await this.getSecrets();
    await populateEnv(secrets, this.options);
    return secrets;
  }

  /**
   * Adds or updates a secret. This requires a read/write token.
   * After writing, the local cache is cleared to ensure the next read fetches the new value.
   * @param key The secret key to set.
   * @param value The new value for the secret.
   */
  public async set(key: string, value: string): Promise<void> {
    try {
      await setSecret(this.redis, this.options, key, value);
      log(`Successfully set secret for key "${key}".`);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "An unknown error occurred during set operation.";
      error(`Failed to set secret: ${errorMessage}`);
      throw new RedenvError(`Failed to set secret: ${errorMessage}`, "UNKNOWN_ERROR");
    }
  }
}

export * from "./types";
