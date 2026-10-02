import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { env } from "../config/env";
import { anthropic } from "./agent";
import type { SandboxWorkspace } from "./sandbox";

export interface AgentFixResult {
  success: boolean;
  summary: string;
  filesModified: string[];
  testOutput?: string;
  error?: string;
}

const AGENT_TOOLS: Tool[] = [
  {
    name: "read_file",
    description: "Read the UTF-8 content of a file within the sandbox repository workspace.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Relative path to the file within the repository, e.g. src/index.ts",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "write_file",
    description: "Write or update content of a file within the sandbox repository workspace.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Relative path to the file within the repository, e.g. src/index.ts",
        },
        content: {
          type: "string",
          description: "The complete content to write into the file",
        },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "search_files",
    description:
      "Search for files by file path or folder name across repository workspace. Example: venues, auth, or +page.svelte.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "File or directory path substring to search for, e.g. venues, user, or +page.svelte",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "grep_code",
    description:
      "Search for code keywords, functions, or text across all repository files. Use this to locate function calls or code snippets like api.venues.get.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Text or keyword pattern to search for in files",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "list_directory",
    description: "List directory contents within the repository workspace.",
    input_schema: {
      type: "object",
      properties: {
        dir_path: {
          type: "string",
          description: "Relative path to the directory, e.g. src or .",
        },
      },
      required: ["dir_path"],
    },
  },
  {
    name: "run_tests",
    description: "Run test suite or lint checks inside the workspace to verify if code fixes work.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "Optional test or check command to execute, default runs repository test or lint",
        },
      },
    },
  },
];

export interface FixTaskContext {
  number: number;
  title: string;
  body: string;
  isPullRequest?: boolean;
}

export async function runAutonomousFixLoop(
  workspace: SandboxWorkspace,
  issue: FixTaskContext,
  maxSteps = 15,
): Promise<AgentFixResult> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      success: false,
      summary: "Skipped: Anthropic API key is not configured",
      filesModified: [],
      error: "MISSING_API_KEY",
    };
  }

  const taskLabel = issue.isPullRequest
    ? `Pull Request #${issue.number}`
    : `Issue #${issue.number}`;
  const actionObjective = issue.isPullRequest
    ? `refine and update Pull Request #${issue.number}: "${issue.title}" based on the requested review feedback and user instructions`
    : `resolve Issue #${issue.number}: "${issue.title}"`;
  const criticalRequirement = issue.isPullRequest
    ? "CRITICAL REQUIREMENT: You MUST call `write_file` to save the modified code to disk so the Pull Request can be updated with a new commit. Do not just output markdown text."
    : "CRITICAL REQUIREMENT: You MUST call `write_file` to save the modified code to disk so a Pull Request can be opened. Do not just output markdown text.";

  const filesModified = new Set<string>();
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        `You are an autonomous coding bot assigned to ${actionObjective}.`,
        "",
        `${taskLabel} Details & Instructions:`,
        issue.body,
        "",
        "ACTIONABLE WORKFLOW:",
        "1. Identify the target file mentioned in the scope or search for it directly.",
        "2. Read the file with `read_file`.",
        "3. Immediately call `write_file` to write the complete corrected code to disk. Do not get stuck in repetitive searching.",
        "4. Verify your fix with `run_tests`.",
        "",
        criticalRequirement,
      ].join("\n"),
    },
  ];

  let step = 0;
  let finalSummary = "No modifications made.";

  while (step < maxSteps) {
    step++;
    console.log(`[AgentLoop] Step ${step}/${maxSteps} - requesting LLM actions...`);

    const response = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 4096,
      system:
        "You are Deus Meus CoBot, an expert autonomous software engineer. Your objective is to solve repository issues by modifying code on disk using `write_file`. Once you have located and read the relevant target file, do not wander or search for external definitions—apply the fix directly using `write_file`. Do not just output code blocks in text—always execute `write_file` to apply the solution to the repository. After modifying files, run tests or checks to verify your changes. Do not include any emojis or emoticons.",
      tools: AGENT_TOOLS,
      messages,
    });

    console.log(`[AgentLoop] Step ${step} - stop_reason: ${response.stop_reason}`);

    for (const block of response.content) {
      if (block.type === "text") {
        finalSummary = block.text;
      }
    }

    if (response.stop_reason !== "tool_use") {
      const fullText = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join(" ")
        .toLowerCase();

      const isExplicitlyResolvedOrNoOp =
        fullText.includes("already resolved") ||
        fullText.includes("already implemented") ||
        fullText.includes("no additional code changes required") ||
        fullText.includes("no code modifications were required") ||
        fullText.includes("no code changes are needed") ||
        fullText.includes("no modifications are required");

      if (filesModified.size === 0 && !isExplicitlyResolvedOrNoOp && step < maxSteps) {
        messages.push({
          role: "assistant",
          content: response.content,
        });
        messages.push({
          role: "user",
          content:
            "CRITICAL: You analyzed the issue and drafted the code, but you have NOT called the `write_file` tool to save the changes to disk yet! You MUST call the `write_file` tool with the exact `file_path` and the complete updated `content` to write the changes to disk now. Do not just output text—execute `write_file` immediately.",
        });
        continue;
      }
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      const { id, name, input } = block;

      try {
        if (name === "search_files") {
          const rawInput = input as Record<string, unknown>;
          const query = String(
            rawInput.query ?? rawInput.pattern ?? rawInput.search ?? rawInput.name ?? "",
          );
          const matches = await workspace.searchFiles(query);
          console.log(`[AgentLoop] search_files query="${query}", matches=${matches.length}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: id,
            content: matches.length > 0 ? matches.join("\n") : "No matching files found.",
          });
        } else if (name === "grep_code") {
          const rawInput = input as Record<string, unknown>;
          const pattern = String(rawInput.pattern ?? rawInput.query ?? rawInput.text ?? "");
          const matches = await workspace.grepCode(pattern);
          console.log(`[AgentLoop] grep_code pattern="${pattern}"`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: id,
            content: matches,
          });
        } else if (name === "read_file") {
          const rawInput = input as Record<string, unknown>;
          const targetRelPath = String(
            rawInput.file_path ?? rawInput.path ?? rawInput.filePath ?? rawInput.file ?? "",
          );
          if (!targetRelPath) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: id,
              content: "Error: Missing file_path parameter.",
              is_error: true,
            });
          } else {
            const filePath = join(workspace.workspacePath, targetRelPath);
            if (!existsSync(filePath)) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: id,
                content: `Error: File not found: ${targetRelPath}`,
                is_error: true,
              });
            } else {
              const content = await readFile(filePath, "utf-8");
              console.log(
                `[AgentLoop] read_file path="${targetRelPath}", size=${content.length} chars`,
              );
              toolResults.push({
                type: "tool_result",
                tool_use_id: id,
                content,
              });
            }
          }
        } else if (name === "write_file") {
          const rawInput = input as Record<string, unknown>;
          const targetRelPath = String(
            rawInput.file_path ?? rawInput.path ?? rawInput.filePath ?? rawInput.file ?? "",
          );
          const content = String(rawInput.content ?? rawInput.new_content ?? rawInput.code ?? "");
          if (!targetRelPath) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: id,
              content: "Error: Missing file_path parameter.",
              is_error: true,
            });
          } else {
            const targetPath = join(workspace.workspacePath, targetRelPath);
            await mkdir(dirname(targetPath), { recursive: true });
            await writeFile(targetPath, content, "utf-8");
            filesModified.add(targetRelPath);
            console.log(
              `[AgentLoop] SUCCESS write_file to disk: "${targetRelPath}", size=${content.length} bytes`,
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: id,
              content: `Successfully wrote file: ${targetRelPath}`,
            });
          }
        } else if (name === "list_directory") {
          const rawInput = input as Record<string, unknown>;
          const targetDir = String(rawInput.dir_path ?? rawInput.path ?? rawInput.dir ?? ".");
          const dirPath = join(workspace.workspacePath, targetDir);
          if (!existsSync(dirPath)) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: id,
              content: `Error: Directory not found: ${targetDir}`,
              is_error: true,
            });
          } else {
            const entries = await readdir(dirPath);
            toolResults.push({
              type: "tool_result",
              tool_use_id: id,
              content: entries.join("\n"),
            });
          }
        } else if (name === "run_tests") {
          const rawInput = input as Record<string, unknown>;
          const cmd = rawInput.command ? String(rawInput.command) : undefined;
          const res = await workspace.runTests(cmd);
          toolResults.push({
            type: "tool_result",
            tool_use_id: id,
            content: `Exit Code: ${res.exitCode}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`,
          });
        }
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: id,
          content: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
          is_error: true,
        });
      }
    }

    messages.push({
      role: "assistant",
      content: response.content,
    });

    messages.push({
      role: "user",
      content: toolResults,
    });
  }

  // If the agent concluded without a detailed explanation, run a synthesis pass
  if (finalSummary === "No modifications made." || finalSummary.length < 50) {
    try {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === "assistant" && Array.isArray(lastMsg.content)) {
        const pendingToolUses = lastMsg.content.filter(
          (b) => (b as { type: string }).type === "tool_use",
        );
        if (pendingToolUses.length > 0) {
          messages.push({
            role: "user",
            content: pendingToolUses.map((tu) => ({
              type: "tool_result" as const,
              tool_use_id: (tu as { id: string }).id,
              content: "Inspection completed.",
            })),
          });
        }
      }

      const summaryResponse = await anthropic.messages.create({
        model: env.ANTHROPIC_MODEL,
        max_tokens: 2500,
        system:
          "You are Deus Meus CoBot, an expert software engineer. Provide a detailed, professional, and clear technical analysis report explaining what was analyzed in the codebase, findings, and clear recommendations. Do not use any emojis. Do not call any tools. Provide your response as text markdown directly.",
        messages: [
          ...messages,
          {
            role: "user",
            content:
              "Do not call any tools. Please provide your complete, detailed technical analysis report as text markdown directly, explaining what you inspected in the codebase, the root cause or resolution status, why changes were or were not needed, and recommendations.",
          },
        ],
      });

      const textBlocks = summaryResponse.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n\n");

      if (textBlocks.trim()) {
        finalSummary = textBlocks.trim();
      }
    } catch (err) {
      console.warn("[AgentLoop] Could not synthesize final summary:", err);
    }
  }

  // Final verification guardrail
  const finalTestResult = await workspace.runTests();
  const testsPassed = finalTestResult.exitCode === 0;

  return {
    success: testsPassed && filesModified.size > 0,
    summary: finalSummary,
    filesModified: Array.from(filesModified),
    testOutput: `${finalTestResult.stdout}\n${finalTestResult.stderr}`,
    error: !testsPassed
      ? `Verification tests did not pass: ${finalTestResult.stderr || finalTestResult.stdout || "test exit code non-zero"}`
      : filesModified.size === 0
        ? "No file modifications were made by the automated analysis."
        : undefined,
  };
}
