# Product Requirement Document (PRD) — Deus Meus CoBot

## 📌 Product Overview
**Deus Meus CoBot** is an autonomous AI-powered GitHub Bot inspired by Bun's *RoboBun*. It automatically receives GitHub webhook events, analyzes code issues and pull requests, runs isolated AI agentic fixes using the Claude API, validates changes against test suites, and submits automated Pull Requests (PRs) or inline code reviews.

---

## 🎯 Primary Goals & Value Proposition
1. **Automated PR Generation**: Convert GitHub Issues or comment triggers (`@cobot fix this`) into verified, tested Pull Requests automatically.
2. **Automated Code & Security Review**: Provide inline code reviews on incoming Pull Requests using OWASP and clean-code guidelines.
3. **Automated Test Verification**: Run `bun test` or test suites in isolated sandboxes to ensure code fixes pass before creating PRs.
4. **Developer Empowerment**: Reduce developer workload on repetitive bug fixes and dependency maintenance.

---

## 🚀 Product Scope & Core Features

### Phase 1: Passive AI Reviewer & Basic PR Generator (MVP)
- **GitHub Webhook Handler**: Securely receive `pull_request`, `issues`, and `issue_comment` events via Bun + Hono.
- **AI Code Reviewer**: Perform automated security and performance reviews on PR diffs using Claude Messages API.
- **Basic Auto-PR Creator**: Generate automated PRs for basic issue fixes using GitHub App API (`octokit`).

### Phase 2: Autonomous RoboBun-Level Agent (Full Execution)
- **Isolated Repo Sandbox**: Clone target repos into temporary sandboxes or Git Worktrees (`/tmp/cobot-jobs/`).
- **Autonomous Agentic Loop**: Allow Claude API to iteratively edit code and run local test suites (`bun test`).
- **Verification Guardrails**: Only push branches and create PRs when local tests pass with 0 errors.
- **Multi-Repo Support**: Installable as a GitHub App across all user repositories with fine-grained permissions.

---

## 🛠️ Technology Stack
- **Runtime**: Bun (v1.1+)
- **Web Framework**: Hono (Web Standards, lightweight, zero runtime lock-in)
- **GitHub Integration**: `octokit` (`@octokit/app`, `@octokit/webhooks`)
- **Queue & Worker**: BullMQ + Redis (Asynchronous task processing & concurrency control)
- **AI Engine**: Anthropic SDK (`@anthropic-ai/sdk`, Claude 3.7 Sonnet / Claude 5 with Prompt Caching)
- **Database & ORM**: PostgreSQL with Drizzle ORM
- **Containerization**: Docker & Docker Compose (App, PostgreSQL, Redis)

---

## 🔄 System Architecture & Data Flow

```
+------------------+         +---------------------+         +----------------------+
|  GitHub Webhook  | ------> |  Hono API Server    | ------> |  BullMQ Task Queue   |
| (Issue/PR Event) |         | (deus-meus-cobot)   |         |  (Redis-backed)      |
+------------------+         +---------------------+         +----------------------+
                                                                        |
                                                                        v
+------------------+         +---------------------+         +----------------------+
| GitHub API (PR)  | <------ | Isolated Runner     | <------ | Claude API Engine    |
| (octokit App)    |         | (bun test / sandbox)|         | (Agentic Tool Loop)  |
+------------------+         +---------------------+         +----------------------+
```

1. **Webhook Event Received**: GitHub triggers `POST /api/v1/webhook` on `deus-meus-cobot`.
2. **HMAC Signature Verification**: Validates `X-Hub-Signature-256` secret header via `@octokit/webhooks`.
3. **Instant Acknowledgment**: Hono returns `202 Accepted` immediately (< 100ms) to prevent GitHub timeouts.
4. **Task Queueing**: Enqueues payload into BullMQ with concurrency limiter.
5. **AI Processing**: Claude API generates diff or code fix using tool calling & Prompt Caching.
6. **Execution & Test Verification**: `bun test` is executed inside isolated workspace/worktree.
7. **PR Creation**: Octokit GitHub App creates branch, commits verified changes, and opens a Pull Request.

---

## 🔒 Security & Safety Controls
- **HMAC Verification**: Reject unauthenticated webhooks.
- **Sanitized Execution**: Restrict command execution inside sandboxed environments.
- **Human-in-the-Loop**: CoBot creates PRs; human maintainers retain final merge authority.
