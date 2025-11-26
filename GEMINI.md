# Gemini Project Context: Redenv

This document provides a comprehensive overview of the `redenv` project to be used as instructional context for AI-assisted development.

## 1. Project Overview

**Redenv** is a zero-knowledge, end-to-end encrypted secret management system designed to replace traditional `.env` files. It uses Upstash Redis as a centralized backend, providing a secure, version-controlled, and dynamic way to manage application secrets.

### Architecture

The project is a **pnpm monorepo** containing three core packages:

*   `@redenv/core`: A foundational package that provides universal cryptographic primitives and shared utilities. It uses the **Web Crypto API** to implement `AES-256-GCM` for encryption and `PBKDF2` for key derivation, making it compatible with Node.js, Deno, Bun, and browser environments.
*   `@redenv/cli`: A comprehensive command-line interface (CLI) for managing secrets. It allows users to perform operations like adding/removing secrets, managing projects and environments, viewing version history, and creating access tokens.
*   `@redenv/client`: A lightweight client library for server-side applications. It enables applications to fetch secrets dynamically at runtime, featuring a high-performance `stale-while-revalidate` cache to ensure speed and resilience.

### Technologies

*   **Language**: TypeScript
*   **Workspace**: pnpm
*   **Bundler**: `tsup`
*   **Testing**: `vitest`
*   **CLI Framework**: `commander`
*   **Backend**: Upstash Redis

## 2. Building and Running

### Installation

To install all dependencies for the entire workspace, run the following command from the project root:
```bash
pnpm install
```

### Building

Each package has its own `build` script that uses `tsup`. To build all packages simultaneously, run the recursive pnpm script from the root:
```bash
pnpm -r build
```

### Running in Development

To run the CLI application in development mode without needing to build it first, use the `dev` script in the `@redenv/cli` package:
```bash
pnpm --filter @redenv/cli dev -- <command>
# Example: pnpm --filter @redenv/cli dev -- list
```

### Testing

The project uses `vitest` for unit testing. To run all tests across the workspace, execute the following command from the project root:
```bash
pnpm test
```
*(Note: Assuming a `test` script is configured in the root `package.json` to run `vitest`. If not, `pnpm vitest` should be used directly.)*

## 3. Development Conventions

*   **Code Style**: The project follows a strict TypeScript configuration (`"strict": true`). Code is linted using ESLint, and formatting should be consistent with the existing style. Modern JavaScript features (ESM, async/await) are used throughout.
*   **Testing**: Unit tests are written with `vitest` and are located alongside the source files they test (e.g., `crypto.ts` and `crypto.test.ts`). The focus is on testing critical logic, especially the cryptographic core.
*   **Versioning and Releases**: The project uses **Changesets**. When making a change that should be included in the release notes, create a new changeset by running `pnpm changeset`. This is the standard process for versioning packages and generating changelogs in this repository.
*   **Modularity**: The separation of concerns between `core`, `cli`, and `client` is a core architectural principle. New functionality should be placed in the appropriate package.
