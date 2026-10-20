#!/usr/bin/env ts-node
/**
 * chaos-tests/run-chaos-suite.ts
 *
 * Orchestrator script for the chaos engineering test suite.
 *
 * 1. Waits for Toxiproxy, Postgres and Redis to be ready
 * 2. Sets up Toxiproxy proxies
 * 3. Runs Jest chaos test files
 * 4. Writes a JSON results summary to chaos-results.json
 *
 * Usage:
 *   # Start infrastructure first:
 *   docker compose -f chaos-tests/docker-compose.chaos.yml up -d
 *
 *   # Run the suite:
 *   npx ts-node chaos-tests/run-chaos-suite.ts
 *
 *   # Or via npm:
 *   npm run chaos:test
 *
 * Issue #297
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import {
  waitForToxiproxy,
  ensureProxy,
  PROXY_NAMES,
  PROXY_CONFIG,
  waitForToxiproxy as _waitForToxiproxy,
} from "./toxiproxy-setup";

const START_TIME = Date.now();

async function main() {
  console.log("🔴 Lumigift Chaos Engineering Suite");
  console.log("====================================\n");

  // ── 1. Wait for Toxiproxy ─────────────────────────────────────────────────
  console.log("Waiting for Toxiproxy…");
  await waitForToxiproxy(30, 2000);

  // ── 2. Create proxies ─────────────────────────────────────────────────────
  console.log("\nConfiguring Toxiproxy proxies…");
  await ensureProxy(
    PROXY_NAMES.postgres,
    PROXY_CONFIG.postgres.listen,
    PROXY_CONFIG.postgres.upstream
  );
  await ensureProxy(PROXY_NAMES.redis, PROXY_CONFIG.redis.listen, PROXY_CONFIG.redis.upstream);

  // ── 3. Run tests ──────────────────────────────────────────────────────────
  console.log("\nRunning chaos tests…\n");

  const suites = [
    { name: "Redis failures", file: "chaos-tests/chaos-redis.test.ts" },
    { name: "Postgres failures", file: "chaos-tests/chaos-postgres.test.ts" },
  ];

  const results: Array<{
    suite: string;
    passed: boolean;
    output: string;
    durationMs: number;
  }> = [];

  let allPassed = true;

  for (const suite of suites) {
    console.log(`\n── Suite: ${suite.name} ──────────────────────`);
    const suiteStart = Date.now();
    let passed = true;
    let output = "";

    try {
      output = execSync(
        `CHAOS_MODE=1 npx jest ${suite.file} --runInBand --forceExit --no-coverage --testTimeout=30000`,
        { encoding: "utf-8", env: { ...process.env, CHAOS_MODE: "1" } }
      );
      console.log(output);
    } catch (err: unknown) {
      passed = false;
      allPassed = false;
      const error = err as { stdout?: string; stderr?: string; message?: string };
      output = (error.stdout ?? "") + (error.stderr ?? error.message ?? "");
      console.error(output);
    }

    results.push({
      suite: suite.name,
      passed,
      output,
      durationMs: Date.now() - suiteStart,
    });
  }

  // ── 4. Write results summary ──────────────────────────────────────────────
  const summary = {
    runAt: new Date().toISOString(),
    totalDurationMs: Date.now() - START_TIME,
    passed: allPassed,
    suites: results,
  };

  writeFileSync("chaos-results.json", JSON.stringify(summary, null, 2));

  console.log("\n====================================");
  console.log(`Chaos suite ${allPassed ? "✅ PASSED" : "❌ FAILED"}`);
  console.log(`Duration: ${((Date.now() - START_TIME) / 1000).toFixed(1)}s`);
  console.log("Results written to chaos-results.json");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Chaos suite runner failed:", err);
  process.exit(1);
});
