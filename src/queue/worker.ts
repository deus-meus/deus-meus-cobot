import { type Job, Worker } from "bullmq";
import { env } from "../config/env";
import { db } from "../db";
import { botJobs } from "../db/schema";
import { reviewPullRequest } from "../services/agent";
import { runAutonomousFixLoop } from "../services/agent-loop";
import { parseWebhookEvent } from "../services/event-parser";
import { getInstallationOctokit } from "../services/github";
import { SandboxWorkspace } from "../services/sandbox";
import { type WebhookJobData, redisConnection } from "./index";

async function logJobToDb(record: {
  id: string;
  deliveryId: string;
  repository: string;
  issueOrPrNumber?: number;
  jobType: string;
  status: string;
  resultPrUrl?: string;
  error?: string;
}): Promise<void> {
  try {
    await db.insert(botJobs).values({
      id: record.id,
      deliveryId: record.deliveryId,
      repository: record.repository,
      issueOrPrNumber: record.issueOrPrNumber,
      jobType: record.jobType,
      status: record.status,
      resultPrUrl: record.resultPrUrl,
      error: record.error,
    });
  } catch (err) {
    console.warn(
      "[DB] Log skip (DB not reachable):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export const webhookWorker = new Worker<WebhookJobData>(
  "webhook-jobs",
  async (job: Job<WebhookJobData>) => {
    const { eventName, action, repository, installationId, payload, deliveryId } = job.data;
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const parsedEvent = parseWebhookEvent(eventName, action, payload);
    if (!parsedEvent) {
      return { skipped: true, reason: "No actionable bot trigger found" };
    }

    if (!installationId) {
      return { skipped: true, reason: "Missing installationId" };
    }

    const octokit = await getInstallationOctokit(installationId);
    if (!octokit) {
      return { skipped: true, reason: "Unable to authenticate Octokit for installation" };
    }

    const [owner, repo] = repository.split("/");
    if (!owner || !repo) {
      return { skipped: true, reason: "Invalid repository slug" };
    }

    // --- Flow 1: Automated PR Review ---
    if (parsedEvent.jobType === "pr_review") {
      const { data: diffData } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: parsedEvent.issueOrPrNumber,
        mediaType: {
          format: "diff",
        },
      });

      const reviewComment = await reviewPullRequest({
        repository,
        pullRequestNumber: parsedEvent.issueOrPrNumber,
        title: parsedEvent.title,
        diff: typeof diffData === "string" ? diffData : JSON.stringify(diffData),
      });

      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: parsedEvent.issueOrPrNumber,
        body: `## Deus Meus CoBot — Automated Code Review\n\n${reviewComment}`,
      });

      await logJobToDb({
        id: jobId,
        deliveryId,
        repository,
        issueOrPrNumber: parsedEvent.issueOrPrNumber,
        jobType: "pr_review",
        status: "success",
      });

      return { success: true, type: "pr_review", pr: parsedEvent.issueOrPrNumber };
    }

    // --- Flow 2: Autonomous Issue Fix & PR Creation ---
    if (parsedEvent.jobType === "issue_fix") {
      const sandbox = new SandboxWorkspace(jobId);
      await sandbox.initialize();

      const branchName = `cobot/fix-issue-${parsedEvent.issueOrPrNumber}`;

      try {
        // Clone repository inside isolated sandbox
        const authData = (await octokit.auth({ type: "installation" })) as { token?: string };
        const token = authData.token;
        const cloneUrl = token
          ? `https://x-access-token:${token}@github.com/${repository}.git`
          : `https://github.com/${repository}.git`;

        const cloneRes = await sandbox.executeCommand([
          "git",
          "clone",
          "--depth",
          "1",
          cloneUrl,
          sandbox.workspacePath,
        ]);

        if (cloneRes.exitCode !== 0) {
          throw new Error(`Git clone failed: ${cloneRes.stderr}`);
        }

        // Checkout a new branch for the fix
        await sandbox.executeCommand(["git", "checkout", "-b", branchName]);

        // Setup dependencies if package.json exists
        await sandbox.setupDependencies();

        // Run the agentic fix loop
        const fixResult = await runAutonomousFixLoop(sandbox, {
          number: parsedEvent.issueOrPrNumber,
          title: parsedEvent.title,
          body: parsedEvent.body,
        });

        // Verification guardrail: only proceed if tests passed and files were modified
        if (!fixResult.success || fixResult.filesModified.length === 0) {
          const isNoChanges = fixResult.filesModified.length === 0;

          const reportMessage = isNoChanges
            ? fixResult.summary.startsWith("#")
              ? fixResult.summary
              : [
                  "## Deus Meus CoBot — Analysis Report",
                  "",
                  `**Target**: \`${repository}\` | **Issue**: #${parsedEvent.issueOrPrNumber} — ${parsedEvent.title}`,
                  "",
                  "### Technical Findings & Diagnostic Assessment",
                  fixResult.summary,
                  "",
                  "### Execution Status",
                  "- **Files Modified**: None (no code changes were committed)",
                  `- **Resolution Note**: ${fixResult.error || "The analysis concluded that no code modifications were necessary."}`,
                  "",
                  "### Recommended Next Steps",
                  "- Review the technical assessment above.",
                  "- If specific code changes are required, please provide detailed requirements or target filenames in a new comment with `@dmc fix <instructions>`.",
                ].join("\n")
            : [
                "## Deus Meus CoBot — Verification Notice",
                "",
                `**Target**: \`${repository}\` | **Issue**: #${parsedEvent.issueOrPrNumber} — ${parsedEvent.title}`,
                "",
                "### Technical Summary",
                fixResult.summary,
                "",
                "### Modified Files",
                ...fixResult.filesModified.map((f) => `- \`${f}\``),
                "",
                "### Verification Details",
                "```text",
                fixResult.error ?? "Verification tests did not pass cleanly.",
                "```",
                "",
                "### Recommended Next Steps",
                "- Review the diagnostic verification output above.",
                "- Ensure local test configurations and dependencies pass cleanly.",
                "- Mention `@dmc fix` to re-trigger automated resolution after adjustments.",
              ].join("\n");

          await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: parsedEvent.issueOrPrNumber,
            body: reportMessage,
          });

          await logJobToDb({
            id: jobId,
            deliveryId,
            repository,
            issueOrPrNumber: parsedEvent.issueOrPrNumber,
            jobType: "issue_fix",
            status: "failed",
            error: fixResult.error,
          });

          return { success: false, reason: fixResult.error };
        }

        // Commit and push the verified changes
        const committerName = env.GIT_COMMITTER_NAME || "Deus Meus CoBot";
        const committerEmail =
          env.GIT_COMMITTER_EMAIL ||
          `${env.GITHUB_APP_ID}+deus-meus-cobot[bot]@users.noreply.github.com`;

        await sandbox.executeCommand(["git", "config", "user.name", committerName]);
        await sandbox.executeCommand(["git", "config", "user.email", committerEmail]);
        await sandbox.executeCommand(["git", "add", "."]);
        await sandbox.executeCommand([
          "git",
          "commit",
          "-m",
          `fix: resolve issue #${parsedEvent.issueOrPrNumber} - ${parsedEvent.title}`,
        ]);
        await sandbox.executeCommand(["git", "push", "-u", "origin", branchName]);

        const prBody = [
          "## Deus Meus CoBot — Automated Issue Resolution",
          "",
          `Closes #${parsedEvent.issueOrPrNumber}`,
          "",
          "### Summary of Changes",
          fixResult.summary,
          "",
          "### Modified Files",
          ...fixResult.filesModified.map((f) => `- \`${f}\``),
          "",
          "### Verification Status",
          "All automated checks and verification gates passed successfully before pull request creation.",
        ].join("\n");

        // Create Pull Request
        const pr = await octokit.rest.pulls.create({
          owner,
          repo,
          title: `fix: resolve issue #${parsedEvent.issueOrPrNumber} - ${parsedEvent.title}`,
          head: branchName,
          base: parsedEvent.baseBranch ?? "main",
          body: prBody,
        });

        // Notify original issue
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: parsedEvent.issueOrPrNumber,
          body: `### Deus Meus CoBot Status\n\nAn automated resolution for this issue has been verified and submitted in Pull Request: ${pr.data.html_url}.`,
        });

        await logJobToDb({
          id: jobId,
          deliveryId,
          repository,
          issueOrPrNumber: parsedEvent.issueOrPrNumber,
          jobType: "issue_fix",
          status: "success",
          resultPrUrl: pr.data.html_url,
        });

        return {
          success: true,
          type: "issue_fix",
          prUrl: pr.data.html_url,
        };
      } finally {
        await sandbox.cleanup();
      }
    }

    // --- Flow 3: Interactive PR Refinement ---
    if (parsedEvent.jobType === "pr_refine") {
      const sandbox = new SandboxWorkspace(jobId);
      await sandbox.initialize();

      try {
        const { data: prData } = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: parsedEvent.issueOrPrNumber,
        });

        const headBranch = prData.head.ref;
        const authData = (await octokit.auth({ type: "installation" })) as { token?: string };
        const token = authData.token;
        const cloneUrl = token
          ? `https://x-access-token:${token}@github.com/${repository}.git`
          : `https://github.com/${repository}.git`;

        const cloneRes = await sandbox.executeCommand([
          "git",
          "clone",
          "--depth",
          "1",
          "--branch",
          headBranch,
          cloneUrl,
          sandbox.workspacePath,
        ]);

        if (cloneRes.exitCode !== 0) {
          const fallbackClone = await sandbox.executeCommand([
            "git",
            "clone",
            cloneUrl,
            sandbox.workspacePath,
          ]);
          if (fallbackClone.exitCode !== 0) {
            throw new Error(`Git clone failed: ${fallbackClone.stderr}`);
          }
          await sandbox.executeCommand(["git", "checkout", headBranch]);
        }

        await sandbox.setupDependencies();

        const fixResult = await runAutonomousFixLoop(sandbox, {
          number: parsedEvent.issueOrPrNumber,
          title: prData.title,
          body: [
            "### Existing Pull Request Context",
            prData.body ?? "No description provided.",
            "",
            "### User Refine Instructions",
            parsedEvent.body,
          ].join("\n"),
          isPullRequest: true,
        });

        if (!fixResult.success || fixResult.filesModified.length === 0) {
          const isNoChanges = fixResult.filesModified.length === 0;

          const reportMessage = isNoChanges
            ? fixResult.summary.startsWith("#")
              ? fixResult.summary
              : [
                  "## Deus Meus CoBot — Refinement Assessment",
                  "",
                  `**Target**: \`${repository}\` | **Pull Request**: #${parsedEvent.issueOrPrNumber} — ${prData.title}`,
                  "",
                  "### Technical Findings & Diagnostic Assessment",
                  fixResult.summary,
                  "",
                  "### Execution Status",
                  "- **Files Modified**: None (no code changes were committed)",
                  `- **Resolution Note**: ${fixResult.error || "The analysis concluded that no code modifications were necessary."}`,
                  "",
                  "### Recommended Next Steps",
                  "- Review the assessment above.",
                  "- To request different changes, reply with `@dmc refine <instructions>`.",
                ].join("\n")
            : [
                "## Deus Meus CoBot — Verification Notice",
                "",
                `**Target**: \`${repository}\` | **Pull Request**: #${parsedEvent.issueOrPrNumber} — ${prData.title}`,
                "",
                "### Technical Summary",
                fixResult.summary,
                "",
                "### Modified Files",
                ...fixResult.filesModified.map((f) => `- \`${f}\``),
                "",
                "### Verification Details",
                "```text",
                fixResult.error ?? "Verification tests did not pass cleanly.",
                "```",
                "",
                "### Recommended Next Steps",
                "- Review the diagnostic verification output above.",
                "- To re-attempt refinement, mention `@dmc refine` with additional adjustments.",
              ].join("\n");

          await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: parsedEvent.issueOrPrNumber,
            body: reportMessage,
          });

          await logJobToDb({
            id: jobId,
            deliveryId,
            repository,
            issueOrPrNumber: parsedEvent.issueOrPrNumber,
            jobType: "pr_refine",
            status: "failed",
            error: fixResult.error,
          });

          return { success: false, reason: fixResult.error };
        }

        const committerName = env.GIT_COMMITTER_NAME || "Deus Meus CoBot";
        const committerEmail =
          env.GIT_COMMITTER_EMAIL ||
          `${env.GITHUB_APP_ID}+deus-meus-cobot[bot]@users.noreply.github.com`;

        await sandbox.executeCommand(["git", "config", "user.name", committerName]);
        await sandbox.executeCommand(["git", "config", "user.email", committerEmail]);
        await sandbox.executeCommand(["git", "add", "."]);
        await sandbox.executeCommand([
          "git",
          "commit",
          "-m",
          `refactor: apply refinement requested in PR #${parsedEvent.issueOrPrNumber}`,
        ]);
        await sandbox.executeCommand(["git", "push", "origin", headBranch]);

        const updateComment = [
          "## Deus Meus CoBot — Pull Request Refined",
          "",
          `Successfully applied and pushed requested changes to branch \`${headBranch}\`.`,
          "",
          "### Summary of Changes",
          fixResult.summary,
          "",
          "### Modified Files",
          ...fixResult.filesModified.map((f) => `- \`${f}\``),
          "",
          "### Verification Status",
          "All automated checks and verification gates passed cleanly before pushing commit.",
        ].join("\n");

        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: parsedEvent.issueOrPrNumber,
          body: updateComment,
        });

        await logJobToDb({
          id: jobId,
          deliveryId,
          repository,
          issueOrPrNumber: parsedEvent.issueOrPrNumber,
          jobType: "pr_refine",
          status: "success",
          resultPrUrl: prData.html_url,
        });

        return {
          success: true,
          type: "pr_refine",
          prUrl: prData.html_url,
        };
      } finally {
        await sandbox.cleanup();
      }
    }

    // --- Flow 4: CI Failure Auto-Repair ---
    if (parsedEvent.jobType === "ci_repair") {
      const runId = parsedEvent.runId ?? parsedEvent.issueOrPrNumber;
      const sandbox = new SandboxWorkspace(jobId);
      await sandbox.initialize();

      try {
        const { data: jobsData } = await octokit.rest.actions.listJobsForWorkflowRun({
          owner,
          repo,
          run_id: runId,
        });

        const failedJobs = jobsData.jobs.filter((j) => j.conclusion === "failure");
        if (failedJobs.length === 0) {
          return { skipped: true, reason: "No failed jobs found in workflow run" };
        }

        const errorLogs: string[] = [];
        for (const job of failedJobs) {
          const failedStep = job.steps?.find((s) => s.conclusion === "failure");
          try {
            const logResponse = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
              owner,
              repo,
              job_id: job.id,
            });

            let rawLog = "";
            if (typeof logResponse.data === "string") {
              rawLog = logResponse.data;
            } else if (typeof logResponse.url === "string") {
              const fetched = await fetch(logResponse.url);
              rawLog = await fetched.text();
            }

            const lines = rawLog.split("\n");
            const tailLines = lines.slice(-120).join("\n");

            errorLogs.push(
              `Job: ${job.name} (Step: ${failedStep?.name ?? "unknown"})\n${tailLines}`,
            );
          } catch {
            errorLogs.push(`Job: ${job.name} failed at step: ${failedStep?.name ?? "unknown"}`);
          }
        }

        const consolidatedLogs = errorLogs.join("\n\n---\n\n");

        const authData = (await octokit.auth({ type: "installation" })) as { token?: string };
        const token = authData.token;
        const cloneUrl = token
          ? `https://x-access-token:${token}@github.com/${repository}.git`
          : `https://github.com/${repository}.git`;

        const targetBranch = parsedEvent.branch ?? "main";
        const repairBranch = parsedEvent.isPullRequest ? targetBranch : `cobot/fix-ci-${runId}`;

        const cloneRes = await sandbox.executeCommand([
          "git",
          "clone",
          "--depth",
          "1",
          "--branch",
          targetBranch,
          cloneUrl,
          sandbox.workspacePath,
        ]);

        if (cloneRes.exitCode !== 0) {
          const fallbackClone = await sandbox.executeCommand([
            "git",
            "clone",
            cloneUrl,
            sandbox.workspacePath,
          ]);
          if (fallbackClone.exitCode !== 0) {
            throw new Error(`Git clone failed: ${fallbackClone.stderr}`);
          }
          await sandbox.executeCommand(["git", "checkout", targetBranch]);
        }

        if (!parsedEvent.isPullRequest) {
          await sandbox.executeCommand(["git", "checkout", "-b", repairBranch]);
        }

        const lastCommitLog = await sandbox.executeCommand(["git", "log", "-1", "--pretty=%B"]);
        if (
          lastCommitLog.stdout.includes("fix(ci):") ||
          lastCommitLog.stdout.includes("repair test/build failure")
        ) {
          console.warn("[Worker] CI repair loop guard: last commit was already by CoBot.");
          return { skipped: true, reason: "CI repair loop guardrail activated" };
        }

        await sandbox.setupDependencies();

        const fixResult = await runAutonomousFixLoop(sandbox, {
          number: runId,
          title: parsedEvent.title,
          body: [
            "### CI Workflow Failure Details",
            parsedEvent.body,
            "",
            "### GitHub Actions Failure Logs",
            "```text",
            consolidatedLogs,
            "```",
            "",
            "### Actionable Repair Directives",
            "1. Analyze the failing test, lint, or build errors from the logs above.",
            "2. Read the source file or test file responsible for the failure.",
            "3. Apply surgical fix with `write_file`.",
            "4. Verify the fix passes with `run_tests`.",
          ].join("\n"),
          isPullRequest: parsedEvent.isPullRequest,
        });

        if (!fixResult.success || fixResult.filesModified.length === 0) {
          if (parsedEvent.isPullRequest) {
            await octokit.rest.issues.createComment({
              owner,
              repo,
              issue_number: parsedEvent.issueOrPrNumber,
              body: [
                "## Deus Meus CoBot — CI Failure Diagnostic Notice",
                "",
                `Detected CI failure in run #${runId}.`,
                "",
                "### Failure Assessment",
                fixResult.summary,
                "",
                "### Diagnostic Note",
                fixResult.error ?? "Automated checks could not resolve the failure cleanly.",
              ].join("\n"),
            });
          }

          await logJobToDb({
            id: jobId,
            deliveryId,
            repository,
            issueOrPrNumber: parsedEvent.issueOrPrNumber,
            jobType: "ci_repair",
            status: "failed",
            error: fixResult.error,
          });

          return { success: false, reason: fixResult.error };
        }

        const committerName = env.GIT_COMMITTER_NAME || "Deus Meus CoBot";
        const committerEmail =
          env.GIT_COMMITTER_EMAIL ||
          `${env.GITHUB_APP_ID}+deus-meus-cobot[bot]@users.noreply.github.com`;

        await sandbox.executeCommand(["git", "config", "user.name", committerName]);
        await sandbox.executeCommand(["git", "config", "user.email", committerEmail]);
        await sandbox.executeCommand(["git", "add", "."]);
        await sandbox.executeCommand([
          "git",
          "commit",
          "-m",
          `fix(ci): repair test/build failure in run #${runId}`,
        ]);
        await sandbox.executeCommand(["git", "push", "-u", "origin", repairBranch]);

        let resultUrl = "";

        if (parsedEvent.isPullRequest) {
          const commentBody = [
            "## Deus Meus CoBot — CI Failure Auto-Repair",
            "",
            `Detected and repaired CI failure from workflow run #${runId}.`,
            "",
            "### Summary of CI Repairs",
            fixResult.summary,
            "",
            "### Modified Files",
            ...fixResult.filesModified.map((f) => `- \`${f}\``),
            "",
            "### Verification Status",
            "Local test runner and verification gates passed with 0 errors before push.",
          ].join("\n");

          await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: parsedEvent.issueOrPrNumber,
            body: commentBody,
          });
          resultUrl = `https://github.com/${repository}/pull/${parsedEvent.issueOrPrNumber}`;
        } else {
          const pr = await octokit.rest.pulls.create({
            owner,
            repo,
            title: `fix(ci): repair workflow failure in run #${runId}`,
            head: repairBranch,
            base: parsedEvent.baseBranch ?? "main",
            body: [
              "## Deus Meus CoBot — CI Failure Auto-Repair",
              "",
              `Resolves CI workflow failure in run #${runId}.`,
              "",
              "### Summary of CI Repairs",
              fixResult.summary,
              "",
              "### Modified Files",
              ...fixResult.filesModified.map((f) => `- \`${f}\``),
              "",
              "### Verification Status",
              "All local verification tests passed before opening this repair PR.",
            ].join("\n"),
          });
          resultUrl = pr.data.html_url;
        }

        await logJobToDb({
          id: jobId,
          deliveryId,
          repository,
          issueOrPrNumber: parsedEvent.issueOrPrNumber,
          jobType: "ci_repair",
          status: "success",
          resultPrUrl: resultUrl,
        });

        return {
          success: true,
          type: "ci_repair",
          prUrl: resultUrl,
        };
      } finally {
        await sandbox.cleanup();
      }
    }

    return { skipped: true, reason: `Unhandled job type: ${parsedEvent.jobType}` };
  },
  {
    connection: redisConnection,
    concurrency: 5,
  },
);

webhookWorker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

webhookWorker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed with error:`, err.message);
});
