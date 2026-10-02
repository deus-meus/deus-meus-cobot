import { Webhooks } from "@octokit/webhooks";
import { Hono } from "hono";
import { env } from "../config/env";
import { webhookQueue } from "../queue";

export const webhookRouter = new Hono();

const webhooks = new Webhooks({
  secret: env.GITHUB_WEBHOOK_SECRET,
});

webhookRouter.post("/webhook", async (c) => {
  const signature = c.req.header("x-hub-signature-256");
  const deliveryId = c.req.header("x-github-delivery");
  const eventName = c.req.header("x-github-event");

  if (!signature || !deliveryId || !eventName) {
    return c.json({ error: "Missing required GitHub webhook headers" }, 400);
  }

  const rawBody = await c.req.text();
  const isValid = await webhooks.verify(rawBody, signature);

  if (!isValid) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const repoObj = payload.repository as { full_name?: string } | undefined;
  const repository = repoObj?.full_name ?? "unknown/unknown";
  const action = typeof payload.action === "string" ? payload.action : undefined;
  const installObj = payload.installation as { id?: number } | undefined;
  const installationId = installObj?.id;

  await webhookQueue.add(`github-${eventName}-${deliveryId}`, {
    deliveryId,
    eventName,
    action,
    repository,
    installationId,
    payload,
  });

  return c.json(
    {
      accepted: true,
      deliveryId,
      status: "queued",
    },
    202,
  );
});
