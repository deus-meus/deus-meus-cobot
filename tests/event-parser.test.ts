import { describe, expect, it } from "bun:test";
import { parseWebhookEvent } from "../src/services/event-parser";

describe("GitHub Event Parser", () => {
  it("should parse pull_request opened event into pr_review job", () => {
    const payload = {
      repository: { full_name: "acme/project", default_branch: "main" },
      sender: { login: "developer", type: "User" },
      installation: { id: 98765 },
      pull_request: {
        number: 42,
        title: "feat: add user login",
        body: "Implements JWT login",
        head: { ref: "feature/login" },
        base: { ref: "main" },
      },
    };

    const result = parseWebhookEvent("pull_request", "opened", payload);
    expect(result).not.toBeNull();
    expect(result?.jobType).toBe("pr_review");
    expect(result?.issueOrPrNumber).toBe(42);
    expect(result?.repository).toBe("acme/project");
    expect(result?.installationId).toBe(98765);
    expect(result?.isPullRequest).toBe(true);
  });

  it("should parse issue_comment with @dmc fix into issue_fix job", () => {
    const payload = {
      repository: { full_name: "acme/project", default_branch: "main" },
      sender: { login: "developer", type: "User" },
      installation: { id: 98765 },
      issue: {
        number: 20,
        title: "bug: map z-index issue",
        body: "Map overlaps modal",
      },
      comment: {
        body: "@dmc fix please verify this",
      },
    };

    const result = parseWebhookEvent("issue_comment", "created", payload);
    expect(result).not.toBeNull();
    expect(result?.jobType).toBe("issue_fix");
    expect(result?.issueOrPrNumber).toBe(20);
  });

  it("should parse issue_comment with @dmc refine on PR into pr_refine job", () => {
    const payload = {
      repository: { full_name: "acme/project", default_branch: "main" },
      sender: { login: "maintainer", type: "User" },
      installation: { id: 98765 },
      issue: {
        number: 363,
        title: "fix: debouncing search",
        pull_request: {},
      },
      comment: {
        body: "@dmc refine adjust debounce delay to 500ms and add logging",
      },
    };

    const result = parseWebhookEvent("issue_comment", "created", payload);
    expect(result).not.toBeNull();
    expect(result?.jobType).toBe("pr_refine");
    expect(result?.issueOrPrNumber).toBe(363);
    expect(result?.isPullRequest).toBe(true);
  });

  it("should parse issue_comment with @dmc fix on PR into pr_refine job", () => {
    const payload = {
      repository: { full_name: "acme/project", default_branch: "main" },
      sender: { login: "maintainer", type: "User" },
      installation: { id: 98765 },
      issue: {
        number: 363,
        title: "fix: debouncing search",
        pull_request: {},
      },
      comment: {
        body: "@dmc fix update the timer teardown logic",
      },
    };

    const result = parseWebhookEvent("issue_comment", "created", payload);
    expect(result).not.toBeNull();
    expect(result?.jobType).toBe("pr_refine");
    expect(result?.issueOrPrNumber).toBe(363);
    expect(result?.isPullRequest).toBe(true);
  });

  it("should parse issue_comment with @dmc review on PR into pr_review job", () => {
    const payload = {
      repository: { full_name: "acme/project", default_branch: "main" },
      sender: { login: "developer", type: "User" },
      installation: { id: 98765 },
      issue: {
        number: 21,
        title: "feat: new payment gateway",
        pull_request: {},
      },
      comment: {
        body: "@dmc review this PR",
      },
    };

    const result = parseWebhookEvent("issue_comment", "created", payload);
    expect(result).not.toBeNull();
    expect(result?.jobType).toBe("pr_review");
    expect(result?.issueOrPrNumber).toBe(21);
    expect(result?.isPullRequest).toBe(true);
  });

  it("should ignore events sent by bots to prevent feedback loops", () => {
    const payload = {
      repository: { full_name: "acme/project" },
      sender: { login: "github-actions[bot]", type: "Bot" },
      installation: { id: 98765 },
      issue: { number: 10, title: "Title" },
      comment: { body: "@dmc fix this" },
    };

    const result = parseWebhookEvent("issue_comment", "created", payload);
    expect(result).toBeNull();
  });

  it("should ignore comments without dmc triggers", () => {
    const payload = {
      repository: { full_name: "acme/project" },
      sender: { login: "contributor", type: "User" },
      installation: { id: 98765 },
      issue: { number: 10, title: "Title" },
      comment: { body: "Just a regular review comment" },
    };

    const result = parseWebhookEvent("issue_comment", "created", payload);
    expect(result).toBeNull();
  });

  it("should parse failed workflow_run on pull request into ci_repair job", () => {
    const payload = {
      repository: { full_name: "acme/project", default_branch: "main" },
      sender: { login: "maintainer", type: "User" },
      installation: { id: 98765 },
      workflow_run: {
        id: 11223344,
        name: "Test & Lint",
        head_branch: "feature/auth",
        conclusion: "failure",
        pull_requests: [
          {
            number: 99,
            head: { ref: "feature/auth" },
            base: { ref: "main" },
          },
        ],
        html_url: "https://github.com/acme/project/actions/runs/11223344",
      },
    };

    const result = parseWebhookEvent("workflow_run", "completed", payload);
    expect(result).not.toBeNull();
    expect(result?.jobType).toBe("ci_repair");
    expect(result?.issueOrPrNumber).toBe(99);
    expect(result?.isPullRequest).toBe(true);
    expect(result?.branch).toBe("feature/auth");
    expect(result?.runId).toBe(11223344);
  });

  it("should parse failed workflow_run on main branch into ci_repair job", () => {
    const payload = {
      repository: { full_name: "acme/project", default_branch: "main" },
      sender: { login: "maintainer", type: "User" },
      installation: { id: 98765 },
      workflow_run: {
        id: 55667788,
        name: "Deploy & CI",
        head_branch: "main",
        conclusion: "failure",
        pull_requests: [],
        html_url: "https://github.com/acme/project/actions/runs/55667788",
      },
    };

    const result = parseWebhookEvent("workflow_run", "completed", payload);
    expect(result).not.toBeNull();
    expect(result?.jobType).toBe("ci_repair");
    expect(result?.issueOrPrNumber).toBe(55667788);
    expect(result?.isPullRequest).toBe(false);
    expect(result?.branch).toBe("main");
  });

  it("should ignore successful workflow_run events", () => {
    const payload = {
      repository: { full_name: "acme/project" },
      sender: { login: "maintainer", type: "User" },
      installation: { id: 98765 },
      workflow_run: {
        id: 99887766,
        name: "Test & Lint",
        conclusion: "success",
      },
    };

    const result = parseWebhookEvent("workflow_run", "completed", payload);
    expect(result).toBeNull();
  });
});
