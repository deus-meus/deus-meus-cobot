# Deus Meus CoBot

[![Bun](https://img.shields.io/badge/Bun-v1.1+-black?logo=bun)](https://bun.sh)
[![Hono](https://img.shields.io/badge/Framework-Hono-orange?logo=hono)](https://hono.dev)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Octokit](https://img.shields.io/badge/GitHub-Octokit%20App-blueviolet?logo=github)](https://github.com/octokit)
[![BullMQ](https://img.shields.io/badge/Queue-BullMQ-red?logo=redis)](https://bullmq.io)
[![Drizzle ORM](https://img.shields.io/badge/ORM-Drizzle-green)](https://orm.drizzle.team)
[![Claude API](https://img.shields.io/badge/AI-Claude%203.7%20%2F%205-purple?logo=anthropic)](https://www.anthropic.com)
[![Biome](https://img.shields.io/badge/Linter-Biome-yellow)](https://biomejs.dev)

An autonomous AI GitHub Bot built on **Bun**, **Hono**, **Octokit (GitHub App)**, **BullMQ**, **PostgreSQL (Drizzle ORM)**, and **Anthropic Claude API**. Inspired by *RoboBun*, Deus Meus CoBot delivers automated code reviews, autonomous issue solving, interactive Pull Request refinement, and self-healing CI/CD repairs.

---

## 🏛️ System Architecture

```text
[GitHub Webhook Event]
       │
       ▼ (POST /api/v1/webhook)
[Hono Server] ──(Verify HMAC X-Hub-Signature-256)──> [Return HTTP 202 Accepted (< 100ms)]
       │
       ▼ (Enqueue Asynchronous Job)
[BullMQ Queue (Redis)]
       │
       ▼ (Worker Consumer)
[Agentic Orchestrator] <─── Tool Loop (read, write, search, grep, test) ───> [Anthropic Claude API]
       │
       ▼ (Execute Surgical Code Fixes)
[Isolated Sandbox Workspace] ───> [Local Verification Gate (bun test / biome check)]
       │ (Pass with 0 errors)
       ▼
[Octokit GitHub App] ───> [Push Branch & Open/Refine Pull Request with Official Bot Avatar]
```

---

## 🌟 Key Features & Trigger Commands

| Command / Event | Trigger Location | Action Performed |
|---|---|---|
| `@dmc fix <instructions>` | GitHub Issue or Comment | Clones repository to isolated sandbox, diagnoses root cause, solves issue with Claude tool calling, verifies with tests, and opens a Pull Request. |
| `@dmc refine <instructions>` | Pull Request Discussion | Checks out the existing PR branch, modifies code according to review feedback, verifies changes, and pushes a new commit to the same branch without opening duplicate PRs. |
| `@dmc review` | Pull Request Comment | Runs deep automated code review analyzing OWASP security guidelines, potential logic bugs, and performance regressions. |
| `pull_request.opened` | Webhook Event | Automatically initiates an automated code review on new pull requests. |
| `workflow_run.completed` (failure) | GitHub Actions CI Event | Ingests failed job console logs, pinpoints error stack traces, and creates an automated repair commit or PR. |

---

## 🏷️ GitHub App Identity & Verified Commits

All git commits authored by the bot automatically link to your official GitHub App profile, rendering the verified badge and custom uploaded logo:
- **Author/Committer Name**: Configurable via `GIT_COMMITTER_NAME` (default: `Deus Meus CoBot`).
- **Committer Email**: Uses the official GitHub App noreply email format:  
  `${GITHUB_APP_ID}+<app-slug>[bot]@users.noreply.github.com`

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.1 or later)
- [Docker](https://www.docker.com/) and Docker Compose
- GitHub App credentials (App ID, Private Key `.pem`, Webhook Secret)
- Anthropic API Key or compatible API gateway (e.g. CLIProxyAPI)

### GitHub App Permissions & Events

Configure your GitHub App (*Settings -> Developer Settings -> GitHub Apps*) with the following permissions:

| Permission | Access | Purpose |
|---|---|---|
| **Repository Contents** | Read & Write | Clone workspaces, commit fixes, and push branches |
| **Issues** | Read & Write | Read issue context and post status reports |
| **Pull Requests** | Read & Write | Read diffs, submit reviews, and create/refine PRs |
| **Actions / Workflows** | Read | Download failed workflow logs for CI auto-repair |

**Subscribed Webhook Events**:
- `Issues`
- `Issue comment`
- `Pull request`
- `Workflow run`

---

### Environment Setup

Create your environment configuration:

```bash
cp .env.example .env
```

Key environment variables:

```ini
PORT=3000
NODE_ENV=development

# GitHub App Configuration
GITHUB_APP_ID=5146647
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# Optional Webhook Proxy (Smee.io)
SMEE_URL=https://smee.io/your-channel-id

# Queue & Storage
REDIS_HOST=localhost
REDIS_PORT=6379
DATABASE_URL=postgres://postgres:postgres@localhost:5432/deus_meus_cobot

# AI Gateway
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-3-7-sonnet-20250219

# Git Identity
GIT_COMMITTER_NAME="Deus Meus CoBot"
GIT_COMMITTER_EMAIL=5146647+deus-meus-cobot[bot]@users.noreply.github.com
```

---

### Installation & Development

```bash
# 1. Install dependencies
bun install

# 2. Push database schema
bunx drizzle-kit push

# 3. Start backing services for local development
docker compose -f docker-compose.dev.yml up -d

# 4. Start API server in development mode
bun dev

# 5. Start background worker
bun worker
```

### Production Deployment (Server)

To run the complete production stack on your server using prebuilt GHCR images:

```bash
docker compose up -d
```

---

## 🧪 Testing & Code Hygiene

```bash
# Run unit tests
bun test

# Run Biome linter & code formatter checks
bun run check

# Apply automatic Biome fixes
bun run check:apply
```

---

## 📄 License

Distributed under the [MIT](LICENSE) License.
