import { Hono } from "hono";
import { logger } from "hono/logger";
import { env } from "./config/env";
import { webhookRouter } from "./routes/webhook";

export const app = new Hono();

app.use("*", logger());

app.get("/", (c) => {
  return c.json({
    name: "Deus Meus CoBot",
    description: "Autonomous AI-powered GitHub Bot inspired by RoboBun",
    status: "active",
    endpoints: {
      health: "/health",
      webhook: "/api/v1/webhook",
    },
  });
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    name: "deus-meus-cobot",
    runtime: "bun",
    timestamp: new Date().toISOString(),
  });
});

app.route("/api/v1", webhookRouter);

console.log(`Deus Meus CoBot server listening on http://localhost:${env.PORT}`);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
