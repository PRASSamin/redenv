# Redenv: A Zero-Knowledge Secret Management System

**A Developer-First, End-to-End Encrypted CLI for Secure and Dynamic Environment Variable Management, Optimized for the Serverless Era.**

---

## Abstract

In modern software development, managing environment variables and secrets (`.env` files) across different environments, teams, and platforms is a primary source of security vulnerabilities, operational friction, and development slowdowns. The rise of immutable infrastructure on serverless platforms (e.g., Vercel, Netlify) has introduced a new paradigm: the "rebuild to rotate" cycle, where simple configuration changes require a full application redeployment.

**Redenv** is a comprehensive solution designed to solve these problems. It is a CLI-first secret management system that centralizes environment variables in a Redis backend you control. It features a robust, zero-knowledge, end-to-end encrypted architecture, ensuring that your secrets are always protected. By decoupling configuration from deployment, Redenv allows development teams to manage secrets dynamically and securely, drastically improving workflow efficiency and security posture.

## 1. The Research Problem: The State of Configuration Management

The management of application secrets has long been a challenge, but the evolution of development and deployment practices has created two distinct, significant problem areas.

#### 1.1 The Traditional Problem: The Chaos of `.env` Files

The de-facto standard for local development configuration, the `.env` file, is a known anti-pattern when used at scale.
- **Synchronization Drift:** As teams grow, keeping `.env` files synchronized between developers is a constant struggle. This often leads to "works on my machine" issues and hours of lost productivity.
- **Insecure Distribution:** The lack of a central source of truth forces teams into insecure practices, such as sharing secrets over Slack, email, or text messages, creating a massive security liability.

#### 1.2 The Modern Problem: The Inflexibility of Build-Time Secrets

Serverless and edge platforms have revolutionized deployment, but they have also cemented a new problem. By treating environment variables as immutable, build-time constants, they create a rigid and slow workflow for configuration changes.
- **The "Rebuild to Rotate" Cycle:** On these platforms, updating a secret (e.g., rotating a leaked API key) is a high-stakes, time-consuming process. A developer must manually change the variable in a web UI, trigger a new build, and wait for the entire deployment pipeline to complete. In an emergency, this delay is unacceptable.
- **Coupling of Concerns:** This paradigm tightly couples an application's *configuration* with its *code*. A simple change to a logging level or a feature flag requires the same process as a major code change, creating operational bottlenecks.

## 2. The Redenv Solution: A New Architectural Thesis

Redenv is architected to solve these problems by re-imagining the relationship between an application and its configuration. It is built on four core principles:

1.  **Centralized & Synchronized:** A single source of truth for all secrets, stored in a Redis database you control.
2.  **Secure by Default (Zero-Knowledge):** A robust end-to-end encryption model ensures that the database is considered "untrusted." Your secrets are never stored in plaintext.
3.  **Complete Version History:** Every change to a secret is recorded in an immutable history, providing a full audit trail and enabling instant rollbacks.
4.  **Dynamic & Decoupled:** Redenv is designed to be used with a runtime client (`@redenv/client`), allowing applications to fetch their configuration on startup. This completely decouples secret rotation from the deployment cycle.
5.  **Developer-First Experience:** A powerful and intuitive CLI provides a complete suite of commands covering the entire secret management lifecycle, with UX-focused features like secure password caching.

## 3. System Design & Technology Choices

The effectiveness of Redenv stems from specific, deliberate technology and architectural choices.

#### 3.1 Technology: Built Exclusively for Upstash Redis

Redenv is built exclusively for **Upstash Redis**, a deliberate design choice that enables universal connectivity and unmatched performance.
- **Unmatched Speed:** Upstash provides extremely low-latency data access, which is critical for application startup times. When an application boots, it must load its secrets instantly; any delay increases cold start times and degrades user experience.
- **Serverless Model:** Upstash's serverless pricing and connection model is a perfect fit for CLI tools and serverless functions, which have intermittent, spiky traffic patterns.
- **HTTP-Based Client:** The `@upstash/redis` client operates over a standard HTTP/REST API. This is a crucial advantage, as it guarantees connectivity from any environment, including restrictive corporate networks, serverless functions, and edge workers where traditional TCP connections may be blocked or impractical.

#### 3.2 Security Architecture: A Zero-Knowledge Model

Redenv's security is its most critical component.
-   **Per-Project Encryption:** Each project is an isolated security domain protected by a unique **Project Encryption Key (PEK)**.
-   **Master Password:** The PEK is "wrapped" (encrypted) by a key derived from a user-provided **Master Password**. This Master Password is known only to the user and is never stored or transmitted.
-   **Key Derivation:** We use `scrypt`, a strong, industry-standard Key Derivation Function, to protect against brute-force attacks on the Master Password.
-   **Authenticated Encryption:** All data, including all historical versions of secrets, is encrypted using `AES-256-GCM`, which provides both confidentiality and integrity.
-   **Service Tokens:** For programmatic access, Redenv uses a secure token system. A token consists of a **Public ID** (a non-secret identifier) and a **Secret Key**. The Secret Key is used to decrypt the PEK for a specific project, allowing a server or CI/CD pipeline to securely fetch secrets without a password. This secret is displayed only once upon creation and must be stored securely by the user.

## 4. Features & Capabilities

Redenv provides a comprehensive suite of commands to manage secrets with confidence.

-   **Core Commands:** `add`, `edit`, `view`, `list`, `remove`
-   **Project Management:** `register`, `drop`, `switch`
-   **Advanced Workflows:** `import`, `export`, `clone`, `diff`, `promote`
-   **Auditing & History:** `history` (`view`, `limit`), `rollback`
-   **Security & Safety:** `change-password`, `backup`, `restore`, `doctor`, `logout`
-   **Application Access:** `token` (`create`, `list`, `revoke`)

## 5. Future Work: The `@redenv/client`

The `redenv` CLI is the complete control plane for managing secrets. The final piece of the vision is the **`@redenv/client`**, a lightweight library that will allow Node.js applications to consume these secrets securely and dynamically at runtime. This will complete the system and provide a full, end-to-end solution.
