# @redenv/client

A lightweight, zero-knowledge client for securely fetching secrets from Redenv in any server-side JavaScript or TypeScript application.

This client is designed for high performance and security. It features an in-memory cache with `stale-while-revalidate` logic and performs all cryptographic operations locally, ensuring your secrets are never exposed.

---

## Features

- **Zero-Knowledge:** All secrets are decrypted on the client side. The backend is treated as an untrusted data store.
- **High-Performance Caching:** An in-memory `stale-while-revalidate` cache serves secrets instantly, providing resilience and low latency.
- **Dynamic Updates:** Fetch the latest version of secrets without redeploying your application.
- **Flexible Usage:** Supports both programmatic access (recommended) and populating `process.env` for legacy use cases.
- **Secure Write-Back:** Allows applications to add or update secrets programmatically (requires a token with sufficient permissions).

## Installation

Install the package using your preferred package manager:

```bash
# With npm
npm install @redenv/client

# With pnpm
pnpm add @redenv/client

# With yarn
yarn add @redenv/client

# With bun
bun add @redenv/client
```

## Usage Guide

### 1. Instantiation and Initialization

The best practice is to create a single, shared instance of the client and initialize it once when your application starts. This "warms up" the cache for fast access later.

**`src/lib/redenv.ts`**

```typescript
import { Redenv } from "@redenv/client";

export const redenv = new Redenv({
  // It is highly recommended to load these from environment variables
  project: process.env.REDENV_PROJECT_NAME!,
  tokenId: process.env.REDENV_TOKEN_ID!,
  token: process.env.REDENV_SECRET_TOKEN_KEY!,
  upstash: {
    url: process.env.UPSTASH_REDIS_URL!,
    token: process.env.UPSTASH_REDIS_TOKEN!,
  },
  environment: process.env.NODE_ENV,
});

// Initialize Redenv once as soon as the module is loaded.
// This fetches all secrets and populates the cache for fast access.
// It also performs an initial population of process.env.
await redenv.init();
```

### 2. Accessing Secrets

There are two ways to access secrets, with programmatic access being the recommended method.

#### Programmatic Access via `.load()`

This is the **safest and most reliable way** to get secrets. Calling `redenv.load()` returns an accessor object. This ensures you always receive the most up-to-date value according to the client's caching strategy (`stale-while-revalidate`).

Because `init()` was called at startup, subsequent calls to `load()` are extremely fast as they read directly from the in-memory cache.

**`src/services/billing.ts`**

```typescript
import { redenv } from "../lib/redenv";

export async function processPayment() {
  // .load() is fast because the cache is already warm.
  // This is the recommended way to ensure you get the latest secret value.
  const secrets = await redenv.load();
  const stripeKey = await secrets.get("STRIPE_API_KEY");

  // ... use the key
}

export async function getActiveFeatureToggles() {
  const secrets = await redenv.load();
  const allSecrets = await secrets.getAll();
  const featureFlags = {};
  for (const key in allSecrets) {
    if (key.startsWith("FEATURE_")) {
      featureFlags[key] = allSecrets[key];
    }
  }
  return featureFlags;
}
```

#### Legacy Access via `process.env` (With Caveats)

While the client does populate `process.env`, it's important to understand the behavior:

- `process.env` is populated **only** when `.init()` or `.load()` is called.
- It is a **point-in-time snapshot** and will **not** be updated automatically in the background.
- If a secret changes in Redenv, `process.env` will contain a stale value until `.load()` is called again.

This method is suitable for scripts or simple apps where secrets do not change during the application's lifecycle. For long-running servers, you must call `.load()` before accessing `process.env` to ensure the values are fresh.

```typescript
import { redenv } from "../lib/redenv";

async function doSomethingWithLatestSecrets() {
  // Explicitly call .load() to refresh the process.env snapshot
  await redenv.load();

  // Now, process.env has the latest values from the cache
  const dbUrl = process.env.DATABASE_URL;
  console.log(dbUrl);
}
```

### 3. Writing Secrets

You can add or update a secret using the `.set()` method. This requires a Service Token with write permissions. Using this method will automatically clear the client's local cache, ensuring the next read is fresh.

```typescript
import { redenv } from "./lib/redenv";

// Update the log level dynamically in response to an admin action
await redenv.set("LOG_LEVEL", "debug");
```

## Configuration Options

The `Redenv` constructor accepts the following options:

| Option        | Type                             | Description                                                                                                                  | Required |
| ------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | :------: |
| `project`     | `string`                         | The name of your Redenv project.                                                                                             |   Yes    |
| `tokenId`     | `string`                         | The public ID of your Redenv service token (e.g., `stk_...`).                                                                |   Yes    |
| `token`       | `string`                         | The secret key of your Redenv service token (e.g., `redenv_sk_...`).                                                         |   Yes    |
| `upstash`     | `{ url: string, token: string }` | Your Upstash Redis REST credentials (URL and Token).                                                                         |   Yes    |
| `environment` | `string`                         | The environment within the project to fetch secrets from (e.g., "production", "staging"). Defaults to `'development'`.       |    No    |
| `cache`       | `{ ttl?: number, swr?: number }` | Caching behavior in seconds. `ttl` is time-to-live, `swr` is stale-while-revalidate. Defaults to `{ ttl: 300, swr: 86400 }`. |    No    |
| `quiet`       | `boolean`                        | If `true`, suppresses informational logs from the client. Defaults to `false`.                                               |    No    |

## Caching Behavior

The client uses a powerful `stale-while-revalidate` caching strategy to ensure your application remains fast and responsive.

- When you request a secret, it's served instantly from an in-memory cache if available.
- If the cached data is older than the `ttl` (time-to-live), it is considered "stale". The client will return the stale data immediately and trigger a non-blocking background fetch to get fresh secrets from Redis.
- This ensures your application's performance is not impacted by fetching secrets, while also guaranteeing that the secrets are eventually consistent and stay up-to-date.
