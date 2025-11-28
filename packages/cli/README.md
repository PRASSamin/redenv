# Redenv CLI

A command-line interface for the Redenv Secret Management System.

**For a detailed overview of the project's architecture, security model, and philosophy, please see the main [README.md](https://github.com/PRASSamin/redenv/blob/main/README.md) at the root of this repository.**

---

## Installation

To install the Redenv CLI globally on your system, use your preferred package manager.

```bash
# With npm
npm install -g @redenv/cli

# With pnpm
pnpm add -g @redenv/cli

# With yarn
yarn global add @redenv/cli

# With bun
bun add -g @redenv/cli
```

## Quick Start

Follow these steps to get started with your first project.

### 1. Setup Redenv

First, you need to connect the CLI to your Upstash Redis database.

Run the setup command:

```bash
redenv setup
```

You will be prompted to enter your Redis URL and Token.

### 2. Register a New Project

Navigate to your local project directory and register it with Redenv. This will create a new, encrypted project.

```bash
redenv register my-first-project
```

You will be prompted to create a strong **Master Password** for this project. Do not lose this password, as it cannot be recovered.

### 3. Add a Secret

Add your first secret to the `development` environment (the default).

```bash
redenv add DATABASE_URL "postgresql://user:pass@host:port/db"
```

You will be prompted for your Master Password to authorize this action. You can then choose to save the unlocked key to your OS keychain for a passwordless workflow in the future.

### 4. View a Secret

You can now view your secret at any time.

```bash
redenv view DATABASE_URL
```

## Commands

Redenv offers a full suite of commands for managing your secrets. For detailed options on any command, run `redenv <command> --help`.

#### Interactive Shell

- `shell`: Launches an interactive REPL (Read-Eval-Print Loop) for a project environment, allowing you to run multiple commands without re-authenticating or re-specifying project/environment.

#### Core Commands

- `add`
- `edit`
- `view`
- `list`
- `remove`

#### Project Management

- `register`
- `drop`
- `switch`

#### Advanced Workflows

- `import`
- `export`
- `clone`
- `diff`
- `sync`

#### Auditing & History

- `history`
  - `history view [key]`
  - `history limit [value]`
- `rollback <key>`

#### Security & Safety

- `change-password`
- `backup`
- `restore`
- `doctor`
- `logout`

#### Application Access

- `token`
  - `token create`
  - `token list`
  - `token revoke`
