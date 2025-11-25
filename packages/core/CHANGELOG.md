# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2025-11-25

### Added

- **Initial Release:** First public version of `@redenv/core`.
- **Cryptographic Primitives:**
  - `encrypt`: Encrypts data using `AES-256-GCM`.
  - `decrypt`: Decrypts data using `AES-256-GCM`.
  - `deriveKey`: Derives an encryption key from a password using `scrypt`.
  - `generateSalt`: Generates a cryptographically secure random salt.
- **Secret Writing Utility:**
  - `writeSecret`: Provides a shared utility for performing the "read-modify-write" cycle for updating a secret's version history in Redis.
