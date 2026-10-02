export type BotJobType =
  | "pr_review"
  | "issue_fix"
  | "pr_refine"
  | "ci_repair"
  | "installation_sync";

export interface ParsedWebhookEvent {
  jobType: BotJobType;
  repository: string;
  installationId?: number;
  issueOrPrNumber: number;
  title: string;
  body: string;
  sender: string;
  isPullRequest: boolean;
  branch?: string;
  baseBranch?: string;
  runId?: number;
}

function isFixTrigger(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("@dmc fix");
}

function isRefineTrigger(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("@dmc refine") || lower.includes("@dmc iterate");
}

function isReviewTrigger(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("@dmc review");
}

export function parseWebhookEvent(
  eventName: string,
  action: string | undefined,
  payload: Record<string, unknown>,
): ParsedWebhookEvent | null {
  const repoObj = payload.repository as { full_name?: string; default_branch?: string } | undefined;
  const repository = repoObj?.full_name;
  if (!repository) {
    return null;
  }

  const senderObj = payload.sender as { login?: string; type?: string } | undefined;
  const sender = senderObj?.login ?? "unknown";

  // Prevent bot feedback loops
  if (senderObj?.type === "Bot" || sender.endsWith("[bot]")) {
    return null;
  }

  const installObj = payload.installation as { id?: number } | undefined;
  const installationId = installObj?.id;

  // 1. Pull Request Events
  if (eventName === "pull_request" && (action === "opened" || action === "synchronize")) {
    const pr = payload.pull_request as
      | {
          number?: number;
          title?: string;
          body?: string;
          head?: { ref?: string };
          base?: { ref?: string };
        }
      | undefined;

    if (!pr?.number) return null;

    return {
      jobType: "pr_review",
      repository,
      installationId,
      issueOrPrNumber: pr.number,
      title: pr.title ?? "",
      body: pr.body ?? "",
      sender,
      isPullRequest: true,
      branch: pr.head?.ref,
      baseBranch: pr.base?.ref ?? repoObj?.default_branch ?? "main",
    };
  }

  // 2. Issue Comment Events (e.g. `@cobot fix this` or `@cobot review`)
  if (eventName === "issue_comment" && action === "created") {
    const comment = payload.comment as { body?: string } | undefined;
    const issue = payload.issue as
      | {
          number?: number;
          title?: string;
          body?: string;
          pull_request?: unknown;
        }
      | undefined;

    if (!comment?.body || !issue?.number) return null;

    const commentBody = comment.body;
    const isPr = Boolean(issue.pull_request);

    if (isPr && (isRefineTrigger(commentBody) || isFixTrigger(commentBody))) {
      return {
        jobType: "pr_refine",
        repository,
        installationId,
        issueOrPrNumber: issue.number,
        title: issue.title ?? "",
        body: comment.body,
        sender,
        isPullRequest: true,
        baseBranch: repoObj?.default_branch ?? "main",
      };
    }

    if (isFixTrigger(commentBody)) {
      const issueDesc = issue.body ? `Issue Description:\n${issue.body}` : "";
      const commentDesc = comment.body ? `Trigger / User Instructions:\n${comment.body}` : "";
      const combinedBody = [issueDesc, commentDesc].filter(Boolean).join("\n\n");

      return {
        jobType: "issue_fix",
        repository,
        installationId,
        issueOrPrNumber: issue.number,
        title: issue.title ?? "",
        body: combinedBody || "No issue description provided.",
        sender,
        isPullRequest: isPr,
        baseBranch: repoObj?.default_branch ?? "main",
      };
    }

    if (isReviewTrigger(commentBody) && isPr) {
      return {
        jobType: "pr_review",
        repository,
        installationId,
        issueOrPrNumber: issue.number,
        title: issue.title ?? "",
        body: comment.body,
        sender,
        isPullRequest: true,
        baseBranch: repoObj?.default_branch ?? "main",
      };
    }
  }

  // 3. Issue Events (e.g. issue created or labeled with `dmc`)
  if (eventName === "issues" && (action === "opened" || action === "labeled")) {
    const issue = payload.issue as
      | {
          number?: number;
          title?: string;
          body?: string;
          labels?: Array<{ name?: string }>;
        }
      | undefined;

    if (!issue?.number) return null;

    const hasDmcLabel = issue.labels?.some((l) => l.name?.toLowerCase() === "dmc");
    const hasTriggerInBody = isFixTrigger(issue.body ?? "");

    // Automatically trigger for all newly opened issues, or if labeled / triggered
    if (action === "opened" || hasDmcLabel || hasTriggerInBody) {
      return {
        jobType: "issue_fix",
        repository,
        installationId,
        issueOrPrNumber: issue.number,
        title: issue.title ?? "",
        body: issue.body ?? "",
        sender,
        isPullRequest: false,
        baseBranch: repoObj?.default_branch ?? "main",
      };
    }
  }

  // 4. Workflow Run Events (CI Failure Auto-Repair)
  if (eventName === "workflow_run" && action === "completed") {
    const run = payload.workflow_run as
      | {
          id?: number;
          name?: string;
          head_branch?: string;
          conclusion?: string;
          pull_requests?: Array<{
            number?: number;
            head?: { ref?: string };
            base?: { ref?: string };
          }>;
          html_url?: string;
        }
      | undefined;

    if (run?.conclusion === "failure" && run.id) {
      const pr = run.pull_requests?.[0];
      const prNumber = pr?.number;
      const headBranch = run.head_branch ?? pr?.head?.ref ?? "main";
      const baseBranch = pr?.base?.ref ?? repoObj?.default_branch ?? "main";

      return {
        jobType: "ci_repair",
        repository,
        installationId,
        issueOrPrNumber: prNumber ?? run.id,
        title: `fix(ci): repair failed ${run.name ?? "Workflow"} run #${run.id}`,
        body: `CI workflow run #${run.id} failed on branch ${headBranch}. URL: ${run.html_url ?? ""}`,
        sender,
        isPullRequest: Boolean(prNumber),
        branch: headBranch,
        baseBranch,
        runId: run.id,
      };
    }
  }

  return null;
}
