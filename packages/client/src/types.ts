/**
 * Configuration options for the Redenv client.
 */
export interface RedenvOptions {
  /**
   * The name of the project to fetch secrets for.
   */
  project: string;
  /**
   * The environment within the project to fetch secrets from.
   * @default 'development'
   */
  environment?: string;
  /**
   * The public ID of the service token. This is also used for auditing write operations.
   */
  tokenId: string;
  /**
   * The secret key of the service token.
   */
  token: string;
  /**
   * Upstash Redis connection details.
   */
  upstash: {
    /**
     * The Upstash Redis REST URL.
     */
    url: string;
    /**
     * The Upstash Redis REST Token.
     */
    token: string;
  };
  /**
   * Configuration for the caching behavior.
   */
  cache?: {
    /**
     * The time in seconds that a cached value should be considered fresh.
     * @default 300 (5 minutes)
     */
    ttl?: number;
    /**
     * staleWhileRevalidate: The time in seconds that a stale value may be served while a background refresh is attempted.
     * @default 86400 (1 day)
     */
    swr?: number;
  };
  /**
   * If "low", will print only error logs and some info logs to the console.
   * If "high", will print all logs to the console.
   * If "none", will not print any logs to the console.
   * @default "none"
   */
  log?: LogPreference;
}


export type LogPreference = "low" | "high" | "none";