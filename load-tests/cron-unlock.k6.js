/**
 * k6 load test — Concurrent gift unlock cron job
 *
 * Issue #289: Add load test for concurrent gift unlock cron job
 *
 * Simulates 1,000 concurrent cron invocations hitting the unlock endpoint
 * to measure Stellar transaction throughput and DB write latency under
 * conditions representative of a high-traffic event (e.g. Valentine's Day midnight).
 *
 * SLO: 99th percentile unlock time < 30 seconds per gift
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 CRON_SECRET=<secret> \
 *     k6 run load-tests/cron-unlock.k6.js \
 *     --out json=load-tests/results/cron-unlock-$(date +%s).json
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// ─── Custom metrics ────────────────────────────────────────────────────────────
const unlockErrors = new Rate("cron_unlock_errors");
const unlockDuration = new Trend("cron_unlock_duration_ms", true);
const stellarTxDuration = new Trend("stellar_tx_duration_ms", true);
const dbWriteDuration = new Trend("db_write_duration_ms", true);

// ─── Options ───────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    concurrent_cron_unlock: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 1000 }, // ramp up to 1,000 VUs
        { duration: "30s", target: 1000 }, // hold at 1,000 for 30 s
        { duration: "10s", target: 0 },    // ramp down
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: {
    // SLO from acceptance criteria
    cron_unlock_duration_ms: ["p(99)<30000"],
    // Generous p95 to track trends
    "http_req_duration{scenario:concurrent_cron_unlock}": ["p(95)<20000"],
    cron_unlock_errors: ["rate<0.05"],
    http_req_failed: ["rate<0.05"],
  },
};

// ─── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const CRON_SECRET = __ENV.CRON_SECRET || "test-cron-secret";

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${CRON_SECRET}`,
  "x-cron-source": "k6-load-test",
};

// ─── Main scenario ─────────────────────────────────────────────────────────────
export default function () {
  const startTime = Date.now();

  // Trigger the cron unlock endpoint
  const res = http.post(
    `${BASE_URL}/api/cron/unlock-gifts`,
    JSON.stringify({ triggeredBy: "k6-load-test" }),
    { headers, timeout: "35s" }
  );

  const duration = Date.now() - startTime;
  unlockDuration.add(duration);

  const ok = check(res, {
    "status is 200 or 202": (r) => r.status === 200 || r.status === 202,
    "response has processed count": (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.processed === "number" || body.success === true;
      } catch {
        return false;
      }
    },
    "unlock time under SLO (30 s)": () => duration < 30_000,
  });

  unlockErrors.add(!ok);

  // Extract timing headers if the API emits them (X-Stellar-Duration-Ms, X-DB-Write-Duration-Ms)
  const stellarMs = parseInt(res.headers["X-Stellar-Duration-Ms"] || "0", 10);
  const dbMs = parseInt(res.headers["X-DB-Write-Duration-Ms"] || "0", 10);
  if (stellarMs > 0) stellarTxDuration.add(stellarMs);
  if (dbMs > 0) dbWriteDuration.add(dbMs);

  // Brief pause to avoid saturating the event loop between batches
  sleep(0.1);
}

export function handleSummary(data) {
  const p99 = data.metrics.cron_unlock_duration_ms?.values?.["p(99)"] ?? "n/a";
  const p95 = data.metrics.cron_unlock_duration_ms?.values?.["p(95)"] ?? "n/a";
  const errorRate = (
    (data.metrics.cron_unlock_errors?.values?.rate ?? 0) * 100
  ).toFixed(2);
  const reqs = data.metrics.http_reqs?.values?.count ?? 0;

  const summary = [
    "# Cron Unlock Load Test Summary",
    "",
    `- Total requests : ${reqs}`,
    `- p95 unlock time: ${Math.round(p95)} ms`,
    `- p99 unlock time: ${Math.round(p99)} ms  (SLO: < 30 000 ms)`,
    `- Error rate     : ${errorRate}%`,
    "",
    "## Stellar TX throughput",
    `- p95: ${Math.round(data.metrics.stellar_tx_duration_ms?.values?.["p(95)"] ?? 0)} ms`,
    `- p99: ${Math.round(data.metrics.stellar_tx_duration_ms?.values?.["p(99)"] ?? 0)} ms`,
    "",
    "## DB write latency",
    `- p95: ${Math.round(data.metrics.db_write_duration_ms?.values?.["p(95)"] ?? 0)} ms`,
    `- p99: ${Math.round(data.metrics.db_write_duration_ms?.values?.["p(99)"] ?? 0)} ms`,
  ].join("\n");

  // Print to stdout so CI can capture it
  console.log(summary);

  return {
    stdout: summary,
  };
}
