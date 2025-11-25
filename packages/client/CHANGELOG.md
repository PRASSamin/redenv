# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2025-11-25

### Added

- **Initial Release:** First public release of the `@redenv/client`.
- **Zero-Knowledge Architecture:** Implemented a secure client that performs all cryptographic operations locally, ensuring secrets are never exposed to the backend or any intermediaries.
- **High-Performance Caching:** Integrated an in-memory `stale-while-revalidate` caching strategy using `cachified` to ensure fast and resilient secret retrieval with minimal impact on application performance.
- **Dual Access Patterns:**
  - **Programmatic Access:** Provides `.load()` which returns a `get()` and `getAll()` accessor for type-safe, explicit secret management.
  - **Environment Population:** Supports populating `process.env` for easy integration with legacy applications.
- **Write-Back Functionality:** Includes a `.set(key, value)` method to allow applications with sufficient permissions to add or update secrets dynamically.
- **Configuration:** The client is configurable via constructor options, including project details, environment, and cache settings (`ttl`, `swr`).
