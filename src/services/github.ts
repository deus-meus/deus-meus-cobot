import { App } from "octokit";
import { env } from "../config/env";

export const githubApp = new App({
  appId: env.GITHUB_APP_ID,
  privateKey: env.GITHUB_PRIVATE_KEY || "dummy-key-for-development",
  webhooks: {
    secret: env.GITHUB_WEBHOOK_SECRET,
  },
});

export async function getInstallationOctokit(installationId: number) {
  if (!env.GITHUB_PRIVATE_KEY) {
    return null;
  }
  return await githubApp.getInstallationOctokit(installationId);
}
