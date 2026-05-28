import express from "express";
import { describe, expect, it } from "vitest";
import { createRateLimit, createTrustedOriginMiddleware } from "./security.js";

describe("security middleware", () => {
  it("rejects untrusted origins and allows localhost origins", async () => {
    const app = express();
    app.use(createTrustedOriginMiddleware({ port: 5173 }));
    app.post("/api/advice", (_req, res) => res.json({ ok: true }));

    const rejected = await appFetch(app, "/api/advice", {
      method: "POST",
      headers: { Origin: "http://evil.example" },
    });
    expect(rejected.status).toBe(403);

    const accepted = await appFetch(app, "/api/advice", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ ok: true });
  });

  it("rate limits repeated requests by client address", async () => {
    const app = express();
    app.use(createRateLimit(2, 60_000));
    app.post("/api/advice", (_req, res) => res.json({ ok: true }));

    expect((await appFetch(app, "/api/advice", { method: "POST" })).status).toBe(200);
    expect((await appFetch(app, "/api/advice", { method: "POST" })).status).toBe(200);
    expect((await appFetch(app, "/api/advice", { method: "POST" })).status).toBe(429);
  });
});

async function appFetch(app: express.Express, path: string, init?: RequestInit): Promise<Response> {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not resolve test server address.");
    }
    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
