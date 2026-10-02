import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";

export const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY || "dummy-key-for-development",
  baseURL: env.ANTHROPIC_BASE_URL || undefined,
});

export interface ReviewPromptInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  diff: string;
}

export async function reviewPullRequest(input: ReviewPromptInput): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    return "Anthropic API key is not configured. Automated review skipped.";
  }

  const response = await anthropic.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 2048,
    system:
      "You are Deus Meus CoBot, an expert software engineer and code reviewer. Analyze the git diff and provide a rigorous, professional, and well-explained code review. Detail potential bugs, security concerns, performance optimizations, and code quality improvements with clear explanations and concrete solutions. Do not include any emojis or emoticons in your response. Structure your output clearly with markdown headers: Summary, Findings & Root Cause Analysis, and Recommended Solutions.",
    messages: [
      {
        role: "user",
        content: `Review the following Pull Request #${input.pullRequestNumber} in repository ${input.repository}:\n\nTitle: ${input.title}\n\nDiff:\n\`\`\`diff\n${input.diff}\n\`\`\``,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (textBlock && textBlock.type === "text") {
    return textBlock.text;
  }

  return "Review completed with empty feedback.";
}
