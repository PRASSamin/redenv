# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2025-11-18

### Changed
- **BREAKING:** The core crypto engine has been completely refactored from the Node.js-specific `crypto` module (using `scrypt`) to the universal **Web Crypto API** (using `PBKDF2`). This makes the entire system compatible with all modern JavaScript runtimes, including serverless and edge environments.
- All commands have been updated to work with the new asynchronous cryptographic functions.

### Fixed
- Resolved a critical TypeScript type conflict between Node.js's `webcrypto.CryptoKey` and the global `CryptoKey` type, ensuring type safety across the project.

---

## [1.0.0] - 2025-11-18

This is the initial public release of the Redenv CLI, a secure, feature-rich, and user-friendly tool for modern secret management.

### Added

- **End-to-End Encryption:** Implemented a full zero-knowledge, end-to-end encryption model using a per-project Master Password system. All secrets are encrypted/decrypted locally and are never stored in plaintext.
- **Per-Secret Version History:** Every change to a secret is now stored in a versioned history, providing a complete audit trail with user and timestamp information.
- **Core Commands:** Full suite of commands for secret management: `add`, `edit`, `view`, `list`, `remove`.
- **Project Management Commands:** Commands for project lifecycle: `register`, `drop`, `switch`.
- **Advanced Workflow Commands:** Powerful commands for team and CI/CD workflows: `import`, `export`, `clone`, `diff`, `promote`.
- **History & Rollback Commands:**
  - `history view [key]`: View the complete version history of a secret.
  - `history limit [value]`: Configure the number of versions to keep per secret.
  - `rollback <key>`: Instantly revert a secret to a previous version.
- **Security & Safety Commands:**
  - `change-password`: Securely rotate a project's Master Password.
  - `backup` & `restore`: Create and restore fully encrypted backups of your projects.
  - `doctor`: A diagnostic tool to check your configuration and connectivity.
- **Application Access Management:**
  - `token` command suite (`create`, `list`, `revoke`) to manage secure, read-only Service Tokens for applications.
- **Secure Password Caching:** Implemented an optional, secure caching of unlocked project keys into the native OS keychain (`keytar`) for a seamless, password-less workflow during a session.
- **Unit Testing Foundation:** Introduced `vitest` and created a foundational test suite for the critical crypto and utility modules.
- **Comprehensive Documentation:** Created a detailed architectural `README.md` for the project root and a practical quick-start guide for the CLI package.

### Changed

- **Improved `register` Command:** The `register` command is now idempotent and intelligently checks for remotely existing projects to prevent accidental overwrites, allowing it to also function as a "connect to existing project" command.
- **Data Model:** Migrated secret storage from a simple key-value model to a versioned JSON structure to support auditing and rollbacks.
- **Refactored Write Logic:** Centralized all secret-writing logic into a single `writeSecret` utility to improve maintainability and consistency.

### Fixed

- **UI Stability:** Resolved multiple bugs where `ora` spinner animations would conflict with `inquirer` prompts, causing display loops and crashes.
- **Cryptography:** Fixed a critical bug in the `decrypt` function's error handling that was masking specific error types.
- **System Compatibility:** Tuned `scrypt` memory parameters to ensure compatibility with different environments, including the `bun` runtime.
- **Security:** Fixed a security flaw where the `change-password` command could incorrectly use a cached keychain entry instead of requiring re-authentication.
- **Data Parsing:** Corrected a recurring `JSON.parse` error in multiple commands by properly handling the auto-parsing behavior of the `@upstash/redis` client.
