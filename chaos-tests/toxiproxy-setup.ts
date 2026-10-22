/**
 * chaos-tests/toxiproxy-setup.ts
 *
 * Helpers for creating and managing Toxiproxy proxies and toxics.
 *
 * Toxiproxy admin API docs: https://github.com/Shopify/toxiproxy#toxics
 *
 * Issue #297 — Chaos engineering tests for Redis and Postgres failures
 */

const TOXIPROXY_API = process.env.TOXIPROXY_API ?? "http://localhost:8474";

export interface Proxy {
  name: string;
  listen: string;
  upstream: string;
  enabled: boolean;
}

export interface Toxic {
  name: string;
  type: string;
  stream: "upstream" | "downstream";
  toxicity: number;
  attributes: Record<string, number>;
}

async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${TOXIPROXY_API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Toxiproxy ${method} ${path} → ${res.status}: ${text}`);
  }

  // Some DELETE endpoints return empty body
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/** Create a proxy (idempotent — deletes and recreates if already exists). */
export async function ensureProxy(name: string, listen: string, upstream: string): Promise<void> {
  // Try to delete first (ignore 404)
  try {
    await apiRequest("DELETE", `/proxies/${name}`);
  } catch {
    // Proxy did not exist — that's fine
  }

  await apiRequest("POST", "/proxies", { name, listen, upstream, enabled: true });
  console.log(`  [toxiproxy] proxy ${name}: ${listen} → ${upstream}`);
}

/** Enable or disable a proxy entirely (simulates hard kill). */
export async function setProxyEnabled(name: string, enabled: boolean): Promise<void> {
  await apiRequest("POST", `/proxies/${name}`, { enabled });
  console.log(`  [toxiproxy] proxy ${name} enabled=${enabled}`);
}

/** Add a timeout toxic that cuts connections after `timeoutMs` ms. */
export async function addTimeoutToxic(proxyName: string, timeoutMs: number): Promise<void> {
  await apiRequest("POST", `/proxies/${proxyName}/toxics`, {
    name: "timeout",
    type: "timeout",
    stream: "upstream",
    toxicity: 1.0,
    attributes: { timeout: timeoutMs },
  });
  console.log(`  [toxiproxy] ${proxyName}: timeout toxic added (${timeoutMs}ms)`);
}

/** Add a latency toxic that introduces artificial delay. */
export async function addLatencyToxic(
  proxyName: string,
  latencyMs: number,
  jitterMs = 0
): Promise<void> {
  await apiRequest("POST", `/proxies/${proxyName}/toxics`, {
    name: "latency",
    type: "latency",
    stream: "upstream",
    toxicity: 1.0,
    attributes: { latency: latencyMs, jitter: jitterMs },
  });
  console.log(`  [toxiproxy] ${proxyName}: latency toxic added (${latencyMs}ms ±${jitterMs}ms)`);
}

/** Remove all toxics from a proxy (restores normal operation). */
export async function clearToxics(proxyName: string): Promise<void> {
  const toxics = await apiRequest<Toxic[]>("GET", `/proxies/${proxyName}/toxics`);
  for (const toxic of toxics) {
    await apiRequest("DELETE", `/proxies/${proxyName}/toxics/${toxic.name}`);
  }
  if (toxics.length > 0) {
    console.log(`  [toxiproxy] ${proxyName}: removed ${toxics.length} toxic(s)`);
  }
}

/** Re-enable a previously disabled proxy. */
export async function restoreProxy(name: string): Promise<void> {
  await setProxyEnabled(name, true);
  await clearToxics(name);
}

/** Wait for Toxiproxy to be reachable. Retries up to `maxAttempts` times. */
export async function waitForToxiproxy(maxAttempts = 30, delayMs = 1000): Promise<void> {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetch(`${TOXIPROXY_API}/version`);
      if (res.ok) {
        const version = await res.text();
        console.log(`  [toxiproxy] ready (version ${version.trim()})`);
        return;
      }
    } catch {
      // Not ready yet
    }
    if (i === maxAttempts) {
      throw new Error(
        `Toxiproxy not reachable after ${maxAttempts} attempts. ` +
          `Is docker compose -f chaos-tests/docker-compose.chaos.yml up running?`
      );
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

export const PROXY_NAMES = {
  postgres: "chaos-postgres",
  redis: "chaos-redis",
} as const;

export const PROXY_CONFIG = {
  postgres: {
    listen: "0.0.0.0:5434",
    upstream: "postgres:5432",
  },
  redis: {
    listen: "0.0.0.0:6381",
    upstream: "redis:6379",
  },
} as const;
