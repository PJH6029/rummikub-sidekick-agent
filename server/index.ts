import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAdvice, getPublicConfig } from "./advice.js";
import { createRateLimit, createTrustedOriginMiddleware } from "./security.js";
import type { AdviceRequest } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST?.trim() || "127.0.0.1";
const isProduction = process.env.NODE_ENV === "production";
const adviceRateLimit = createRateLimit(20, 60_000);
const requireTrustedOrigin = createTrustedOriginMiddleware({
  port,
  allowedOrigin: process.env.RUMMIKUB_ALLOWED_ORIGIN?.trim(),
});

const app = express();
app.use(express.json({ limit: "8mb" }));

app.get("/api/config", (_req, res) => {
  res.json(getPublicConfig());
});

app.post("/api/advice", requireTrustedOrigin, adviceRateLimit, async (req, res) => {
  try {
    const advice = await generateAdvice(req.body as AdviceRequest);
    res.json(advice);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Unknown advice error",
    });
  }
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

if (isProduction) {
  const distPath = path.join(root, "dist");
  app.use(express.static(distPath));
  app.use((_req, res) => {
    res.type("html").send(fs.readFileSync(path.join(distPath, "index.html"), "utf8"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root,
    appType: "spa",
    server: { middlewareMode: true },
  });
  app.use(vite.middlewares);
}

app.listen(port, host, () => {
  console.log(`Rummikub Sidekick listening on http://${host}:${port}`);
});
