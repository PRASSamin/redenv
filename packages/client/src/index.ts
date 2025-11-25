import {
  deriveKey,
  decrypt,
  importKey,
  hexToBuffer,
  writeSecret,
} from "@redenv/core";
import { cachified } from "cachified";
import type { CacheEntry } from "cachified";
import { Redis } from "@upstash/redis";
import { LRUCache } from "lru-cache";
import type { LoadFunction, RedenvOptions } from "./types";

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
  private pek?: CryptoKey; // Cache the decrypted Project Encryption Key
  private redis: Redis;

  constructor({ ...options }: RedenvOptions) {
    this.validateOptions(options);

    this.options = {
      ...options,
      environment: options.environment || "development",
      quiet: options.quiet ?? true,
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

  private log(message: string) {
    if (!this.options.quiet) console.log(`[redenv] ${message}`);
  }

  private logError(message: string) {
    if (!this.options.quiet) console.error(`[redenv] Error: ${message}`);
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
      const errorMessage = `[redenv] Missing required configuration options: ${missing.join(
        ", "
      )}`;
      throw new Error(errorMessage);
    }
  }

  private async _getPEK(): Promise<CryptoKey> {
    if (this.pek) {
      return this.pek;
    }
    this.log("Fetching project encryption key...");
    const metaKey = `meta@${this.options.project}`;
    const metadata = await this.redis.hgetall<Record<string, any>>(metaKey);
    if (!metadata)
      throw new Error(`Project "${this.options.project}" not found.`);

    const serviceTokens =
      typeof metadata.serviceTokens === "string"
        ? JSON.parse(metadata.serviceTokens)
        : metadata.serviceTokens;
    const tokenInfo = serviceTokens?.[this.options.tokenId];
    if (!tokenInfo) throw new Error("Invalid Redenv Token ID.");

    const salt = hexToBuffer(tokenInfo.salt);
    const tokenKey = await deriveKey(this.options.token, salt);
    const decryptedPEKHex = await decrypt(tokenInfo.encryptedPEK, tokenKey);

    this.pek = await importKey(decryptedPEKHex);
    return this.pek;
  }

  private async _fetchAndDecryptAll(): Promise<Record<string, string>> {
    this.log("Fetching real-time secrets from source...");

    const pek = await this._getPEK();
    const envKey = `${this.options.environment}:${this.options.project}`;
    const versionedSecrets = await this.redis.hgetall<Record<string, any>>(
      envKey
    );

    const secrets: Record<string, string> = {};
    if (!versionedSecrets) {
      this.log("No secrets found for this environment.");
      return secrets;
    }

    const decryptionPromises = Object.entries(versionedSecrets).map(
      async ([key, history]) => {
        try {
          if (!Array.isArray(history) || history.length === 0) return null;
          const decryptedValue = await decrypt(history[0].value, pek);
          return { key, value: decryptedValue };
        } catch {
          this.logError(`Failed to decrypt secret "${key}".`);
          return null;
        }
      }
    );

    const decryptedResults = await Promise.all(decryptionPromises);
    for (const result of decryptedResults) {
      if (result) {
        secrets[result.key] = result.value;
      }
    }

    this.log(`Successfully loaded ${Object.keys(secrets).length} secrets.`);
    this._populateEnv(secrets);
    return secrets;
  }

  private getCacheKey(): string {
    return `redenv:${this.options.project}:${this.options.environment}`;
  }

  private getSecrets(): Promise<Record<string, string>> {
    return cachified({
      key: this.getCacheKey(),
      cache: lru,
      getFreshValue: () => this._fetchAndDecryptAll(),
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
  public async load(): Promise<LoadFunction> {
    const secrets = await this.getSecrets();
    await this._populateEnv(secrets);
    return {
      get: async (key: string): Promise<string | undefined> => {
        return (await this.getSecrets())[key];
      },
      getAll: async (): Promise<Record<string, string>> => {
        return this.getSecrets();
      },
    };
  }

  /**
   * Adds or updates a secret. This requires a read/write token.
   * After writing, the local cache is cleared to ensure the next read fetches the new value.
   * @param key The secret key to set.
   * @param value The new value for the secret.
   */
  public async set(key: string, value: string): Promise<void> {
    try {
      const pek = await this._getPEK();
      await writeSecret(
        this.redis,
        this.options.project,
        this.options.environment,
        key,
        value,
        pek,
        this.options.tokenId // Use tokenId for auditing
      );
      // Clear the cache to ensure the next `get` call is fresh
      lru.delete(this.getCacheKey());
      this.log(`Successfully set secret for key "${key}".`);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unknown error occurred during set operation.";
      this.logError(`Failed to set secret: ${errorMessage}`);
      throw new Error(`Failed to set secret: ${errorMessage}`);
    }
  }

  /**
   * Injects secrets into the current runtime's environment.
   * Supports Node.js (`process.env`) and Deno (`Deno.env`).
   */
  private async _populateEnv(secrets: Record<string, string>): Promise<void> {
    this.log("Populating environment with secrets...");
    let injectedCount = 0;

    const isDeno =
      // @ts-expect-error: Check for Deno global
      typeof Deno !== "undefined" && typeof Deno.env !== "undefined";

    for (const key in secrets) {
      if (Object.prototype.hasOwnProperty.call(secrets, key)) {
        const value = secrets[key];
        if (isDeno) {
          // @ts-expect-error: Deno.env.set
          Deno.env.set(key, value);
        } else {
          process.env[key] = value;
        }
        injectedCount++;
      }
    }
    this.log(`Injection complete. ${injectedCount} variables were set.`);
  }
}
