import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getRedisClient } from "@/lib/redis";
import { serverConfig } from "@/server/config";

/**
 * Readiness probe — checks all dependencies before accepting traffic.
 * GET /api/health/ready
 *
 * Returns 200 when all checks pass; 503 when any dependency is degraded.
 *
 * Security: check status values are "ok" | "error" only — no connection
 * strings, stack traces, or internal details are ever returned.
 */
export async function GET() {
  const [postgres, redis, horizon] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkHorizon(serverConfig.stellar.horizonUrl),
  ]);

  const checks = { postgres, redis, horizon };
  const degraded = Object.values(checks).some((s) => s === "error");
  const status = degraded ? "degraded" : "ok";

  return NextResponse.json(
    { status, timestamp: new Date().toISOString(), postgres, redis, checks },
    { status: degraded ? 503 : 200 }
  );
}

async function checkDb(): Promise<"ok" | "error"> {
  try {
    await pool.query("SELECT 1");
    return "ok";
  } catch {
    return "error";
  }
}

/** Redis probe timeout — keeps the readiness probe from hanging. */
const REDIS_TIMEOUT_MS = 500;

async function checkRedis(): Promise<"ok" | "error"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Redis health check timed out")), REDIS_TIMEOUT_MS);
    });
    await Promise.race([getRedisClient().then((client) => client.ping()), timeout]);
    return "ok";
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

async function checkHorizon(url: string): Promise<"ok" | "error"> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}
