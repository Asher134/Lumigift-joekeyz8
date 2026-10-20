import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getRedisMetrics, withRedis } from "@/lib/redis";
import { serverConfig } from "@/server/config";

/**
 * Health / readiness endpoints — excluded from auth middleware.
 *
 * GET /api/health          → liveness probe
 *   Returns 200 as long as the process is running.
 *   Orchestrators (Kubernetes, Docker) use this to decide whether to
 *   restart the container.  No dependency checks are performed so a
 *   slow database cannot cause a live container to be killed.
 *
 * GET /api/health/ready    → readiness probe
 *   Checks each dependency and returns 200 only when all are healthy.
 *   Orchestrators use this to decide whether to route traffic to the
 *   instance.  Returns 503 when any dependency is degraded so the
 *   load-balancer stops sending new requests.
 *
 * Security: responses never include connection strings, credentials, or
 * internal stack details.  Check names are generic ("db", "redis",
 * "horizon") — not table names, IP addresses, or error messages.
 */

  const checks = { db, redis, horizon };
  const redisMetrics = getRedisMetrics();
  const degraded = Object.values(checks).some((s) => s === "error");
  const status = degraded ? "degraded" : "ok";

  return NextResponse.json(
    { status, timestamp: new Date().toISOString(), checks, metrics: { redis: redisMetrics } },
    { status: degraded ? 503 : 200 }
  );
}

// ── Readiness helpers ─────────────────────────────────────────────────────────

async function checkDb(): Promise<"ok" | "error"> {
  try {
    await pool.query("SELECT 1");
    return "ok";
  } catch {
    return "error";
  }
}

async function checkRedis(): Promise<"ok" | "error"> {
  try {
    await withRedis("health_check", (client) => client.ping());
    return "ok";
  } catch {
    return "error";
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
