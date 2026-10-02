# Deus Meus CoBot

Autonomous AI GitHub Bot built on Bun, Hono, Octokit (GitHub App), BullMQ, PostgreSQL (Drizzle ORM), and Anthropic Claude API.

---

## 🌟 Key Features

1. **Automated PR Code Reviews**
   - Automatically analyzes Pull Request diffs upon opening or synchronization.
   - Evaluates code for OWASP security standards, bugs, and performance regressions.
   - Can also be triggered explicitly via `@dmc review` in PR comments.

2. **Autonomous Issue Resolution & PR Creation**
   - Triggers autonomously when an issue is opened or mentioned with `@dmc fix <instructions>`.
   - Clones repository into an isolated sandbox workspace (`/tmp/cobot-jobs/job-<id>/`).
   - Uses an autonomous Claude tool loop (`search_files`, `read_file`, `write_file`, `grep_code`, `list_directory`, `run_tests`).
   - Verifies all fixes with local test runners / linters before committing and opening a Pull Request.

3. **Interactive PR Refinement (`@dmc refine`)**
   - Collaborate directly with the bot on active Pull Requests.
   - Mention `@dmc refine <instructions>` or `@dmc fix <instructions>` on a PR discussion thread.
   - Checks out the existing PR branch, applies modifications, runs verification checks, and pushes a new commit to the same branch without opening duplicate PRs.

4. **CI Failure Auto-Repair (`workflow_run`)**
   - Listens to GitHub Actions completion events with `conclusion: "failure"`.
   - Downloads failed job execution logs via Octokit API.
   - Extracts relevant stack traces, diagnoses the root cause, and applies a verified repair commit to the PR branch or opens an automated repair PR.
   - Includes anti-loop guardrails to prevent infinite repair cycles.

5. **GitHub App Identity & Verified Commits**
   - Commits are signed with the configured `GIT_COMMITTER_NAME` (e.g. `Deus Meus CoBot`) and official GitHub App noreply email (`<app-id>+<slug>[bot]@users.noreply.github.com`).
   - Automatically renders the verified badge and custom GitHub App avatar logo on all git commits.

---

## 🏗️ Architecture & Tech Stack

- **Runtime**: [Bun](https://bun.sh) (v1.1+)
- **HTTP Server**: [Hono](https://hono.dev) (Web Standards, lightweight, Bun-native)
- **GitHub Integration**: Official Octokit Suite (`@octokit/app`, `@octokit/webhooks`, `octokit`)
- **Queue & Async Processing**: [BullMQ](https://bullmq.io) & [Redis](https://redis.io)
- **AI SDK**: [`@anthropic-ai/sdk`](https://docs.anthropic.com) (Claude 3.7 Sonnet / Claude 5)
- **Database & ORM**: PostgreSQL & [Drizzle ORM](https://orm.drizzle.team)
- **Linter & Formatter**: [Biome](https://biomejs.dev)

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.1 or later)
- [Docker](https://www.docker.com/) and Docker Compose
- GitHub App with appropriate permissions (Issues, Pull Requests, Contents, Actions, Webhooks)
- Anthropic API Key or compatible API gateway (e.g. CLIProxyAPI)

### Environment Configuration

Copy the example environment file and configure your credentials:

```bash
cp .env.example .env
```

Key environment variables:

| Variable | Description |
|---|---|
| `PORT` | API server port (default: `3000`) |
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | GitHub App private key (`.pem` format or base64) |
| `GITHUB_WEBHOOK_SECRET` | Secret configured in GitHub App webhook settings |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_BASE_URL` | Optional custom API gateway URL |
| `REDIS_HOST` | Redis host (default: `localhost`) |
| `DATABASE_URL` | PostgreSQL connection URL |
| `GIT_COMMITTER_NAME` | Git author/committer name (default: `Deus Meus CoBot`) |
| `GIT_COMMITTER_EMAIL` | Optional GitHub App noreply email |

### Installation

```bash
# Install dependencies
bun install

# Run database migrations / schema push
bunx drizzle-kit push
```

### Running Locally

```bash
# Start background infrastructure (Redis, PostgreSQL, Smee webhook relay)
docker compose up -d cobot-redis cobot-postgres cobot-smee

# Start API server in watch mode
bun dev

# Start queue worker in watch mode
bun worker
```

### Running via Docker Compose

```bash
docker compose up -d
```

---

## 🧪 Testing & Code Quality

```bash
# Run unit tests
bun test

# Run code formatting & linter checks
bun run check

# Apply automatic linter fixes
bun run check:apply
```

---

## 📄 License

MIT
