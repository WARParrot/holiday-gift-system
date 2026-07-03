import type { NextFunction, Request, Response } from 'express';

/**
 * A tiny dependency-free fixed-window rate limiter.
 *
 * Keeps per-key hit counts in an in-process Map with a window expiry. This is
 * intentionally simple: it protects a single-process deployment (the shape this
 * app ships in) against brute-force and abuse without pulling in an external
 * store. For a multi-instance deployment, swap the Map for a shared store
 * (Redis) — the middleware contract stays the same.
 *
 * Keying is by client IP. Behind a trusted proxy, enable Express `trust proxy`
 * so `req.ip` reflects the real client.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Optional label used in the error message (e.g. "auth"). */
  label?: string;
}

export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, label } = options;
  const buckets = new Map<string, Bucket>();

  // Opportunistically evict expired buckets so the Map can't grow unbounded.
  function sweep(now: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  let lastSweep = Date.now();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      sweep(now);
      lastSweep = now;
    }

    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: `Too many ${label ? `${label} ` : ''}requests. Try again in ${retryAfter}s.`,
      });
      return;
    }
    next();
  };
}
