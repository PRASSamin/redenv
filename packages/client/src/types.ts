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
   * If true, will not print any informational logs to the console.
   * @default false
   */
  quiet?: boolean;
}

export interface LoadFunction {
  get: (key: string) => Promise<string | undefined>;
  getAll: () => Promise<Record<string, string>>;
}
