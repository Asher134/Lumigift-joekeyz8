export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Validate environment variables at startup before any database or external service connections
    const { validateEnv } = await import("@/server/config/env");
    validateEnv();

    const { logPoolMetrics, closePool } = await import("@/lib/db");
    const { closeRedisClient } = await import("@/lib/redis");
    const { logger } = await import("@/lib/logger");

    logger.info("Application starting");
    logPoolMetrics();

    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      process.once(sig, async () => {
        logger.info({ signal: sig }, "Shutting down");
        // Close database pool and Redis client concurrently to drain
        // in-flight requests within the shutdown grace period.
        await Promise.allSettled([closePool(), closeRedisClient()]);
        process.exit(0);
      });
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
