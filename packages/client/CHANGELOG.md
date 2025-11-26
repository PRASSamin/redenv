# Changelog

All notable changes to this project will be documented in this file.

## [1.0.5] - 2025-11-26

### Added

- Introduced a dedicated entry point for core utility functions: `@redenv/client/utils`. These functions (e.g., `fetchAndDecrypt`, `setSecret`) are now accessible for advanced use cases and building framework-specific clients.

### Changed

- Back to [1.0.1](#101---2025-11-26) for the latest stable release.

## [1.0.1] - 2025-11-26

### Changed

- load() now returns a Record<string, string> instead of get() and getAll(). so from now on use load() to get secrets.

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
