# Deus Meus CoBot — AI Development Guide

## Project Context
`deus-meus-cobot` is an autonomous AI GitHub Bot built on Bun, Hono, Octokit (GitHub App), BullMQ, Drizzle ORM, and Claude API to automate code reviews, bug fixing, test verification, and PR creation.

---

## Technical Stack & Tooling
- **Runtime**: Bun
- **Framework**: Hono (Web Standards, lightweight, Bun-native)
- **GitHub API**: `octokit` (`@octokit/app`, `@octokit/webhooks`)
- **Queue & Worker**: BullMQ & Redis
- **AI SDK**: `@anthropic-ai/sdk` (Claude 3.7 Sonnet / Claude 5)
- **Database & ORM**: PostgreSQL & Drizzle ORM
- **Validation**: Zod / `@hono/zod-validator`

---

## Development & Test Commands
```bash
# Install dependencies
bun install

# Run development server with hot reload
bun dev

# Run background queue worker
bun worker

# Run test suite
bun test

# Run code linter & formatter
bun biome check .

# Database migration / schema push
bunx drizzle-kit push
```

---

## Architecture & Code Principles
1. **SOLID & Single Responsibility**: Keep webhook handlers, queue workers, GitHub API clients, and AI agent logic separate.
2. **Asynchronous Webhook Processing**: Always acknowledge webhooks with HTTP `202 Accepted` immediately, offloading heavy agentic loops to BullMQ workers.
3. **Defensive Safety & Guard Clauses**: Validate all incoming GitHub signatures (`X-Hub-Signature-256`) before processing payloads. Return early on unauthorized requests.
4. **Isolated Sandbox Verification**: Always verify code fixes via `bun test` inside isolated workspaces or Git Worktrees before creating PRs.
5. **No Direct Master Merges**: CoBot creates feature branches and Pull Requests. Final merges are performed manually by maintainers.
6. **Clean Code & Conventions**: Use TypeScript strict mode, camelCase for variables/functions, PascalCase for classes/types, and Conventional Commits (`feat:`, `fix:`, `chore:`).
