import type express from "express";

type RateBucket = {
  count: number;
  resetAt: number;
};

export function createTrustedOriginMiddleware(options: { port: number; allowedOrigin?: string }) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const origin = req.get("origin");
    if (!origin || allowedOrigins(options).has(origin)) {
      next();
      return;
    }

    res.status(403).json({ error: "Untrusted request origin." });
  };
}

export function allowedOrigins(options: { port: number; allowedOrigin?: string }): Set<string> {
  return new Set(
    [
      `http://127.0.0.1:${options.port}`,
      `http://localhost:${options.port}`,
      `http://[::1]:${options.port}`,
      options.allowedOrigin,
    ].filter(Boolean) as string[],
  );
}

export function createRateLimit(maxRequests: number, windowMs: number) {
  const buckets = new Map<string, RateBucket>();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (bucket.count >= maxRequests) {
      res.status(429).json({ error: "Too many advice requests. Try again shortly." });
      return;
    }

    bucket.count += 1;
    next();
  };
}
