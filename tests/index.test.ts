import { describe, expect, it } from "bun:test";
import { app } from "../src/index";

describe("Deus Meus CoBot API Server", () => {
  it("GET /health should return 200 OK with runtime status", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      name: string;
      runtime: string;
    };
    expect(body.status).toBe("ok");
    expect(body.name).toBe("deus-meus-cobot");
    expect(body.runtime).toBe("bun");
  });

  it("POST /api/v1/webhook should reject requests without GitHub headers with 400", async () => {
    const res = await app.request("/api/v1/webhook", {
      method: "POST",
      body: JSON.stringify({ action: "opened" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Missing required GitHub webhook headers");
  });

  it("POST /api/v1/webhook should reject requests with invalid signature with 401", async () => {
    const res = await app.request("/api/v1/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": "sha256=invalid-signature-digest",
        "x-github-delivery": "delivery-uuid-12345",
        "x-github-event": "pull_request",
      },
      body: JSON.stringify({ action: "opened" }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid signature");
  });
});
