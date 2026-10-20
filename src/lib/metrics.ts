/**
 * Lightweight observability metrics for cron jobs and webhooks.
 *
 * Emits structured JSON log lines (via the pino logger) that can be
 * ingested by any log aggregation service (Logtail, Datadog, CloudWatch).
 * Errors are also captured in Sentry with a metric-tagged scope.
 *
 * Design constraints:
 *   - No PII or secrets are ever logged. Fields such as phone numbers,
 *     payment references, and gift amounts are intentionally excluded.
 *   - All values are numeric counters, durations (ms), or safe status
 *     strings so dashboards can be built on top without scrubbing.
 *
 * Usage:
 *   const timer = startTimer();
 *   try {
 *     const result = await doWork();
 *     recordCronSuccess("cron/unlock", timer(), { processed: result });
 *   } catch (err) {
 *     recordCronFailure("cron/unlock", timer(), err);
 *   }
 */

import * as Sentry from "@sentry/nextjs";
import { logger } from "@/lib/logger";

// ── Timer ─────────────────────────────────────────────────────────────────────

/**
 * Returns a function that, when called, returns the elapsed time in milliseconds
 * since startTimer() was invoked.
 */
export function startTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}

// ── Cron metrics ─────────────────────────────────────────────────────────────

/**
 * Records a successful cron run.
 *
 * @param job       - Identifier for the cron job, e.g. "cron/unlock".
 * @param durationMs - Elapsed time in milliseconds.
 * @param data       - Safe numeric or string counters (no PII).
 */
export function recordCronSuccess(
  job: string,
  durationMs: number,
  data?: Record<string, number | string>
): void {
  logger.info({ metric: "cron.run", job, status: "success", durationMs, ...data }, "[cron] run ok");
}

/**
 * Records a failed cron run. The error message is captured but the full
 * stack is kept server-side only via Sentry; nothing sensitive reaches logs.
 *
 * @param job        - Identifier for the cron job.
 * @param durationMs - Elapsed time in milliseconds before the failure.
 * @param err        - The thrown error.
 */
export function recordCronFailure(job: string, durationMs: number, err: unknown): void {
  const reason = err instanceof Error ? err.message : String(err);
  logger.error(
    { metric: "cron.run", job, status: "error", durationMs, reason },
    "[cron] run failed"
  );

  Sentry.withScope((scope) => {
    scope.setTag("metric", "cron.run");
    scope.setTag("job", job);
    scope.setExtra("durationMs", durationMs);
    Sentry.captureException(err);
  });
}

// ── Webhook metrics ───────────────────────────────────────────────────────────

/**
 * Records a successfully processed webhook event.
 *
 * @param provider   - Payment provider identifier, e.g. "paystack" or "stripe".
 * @param eventType  - The webhook event type string (safe to log, not PII).
 * @param durationMs - Processing time in milliseconds.
 * @param status     - Outcome of the business logic, e.g. "locked" or "ignored".
 */
export function recordWebhookSuccess(
  provider: string,
  eventType: string,
  durationMs: number,
  status: string
): void {
  logger.info(
    { metric: "webhook.event", provider, eventType, status, durationMs },
    "[webhook] processed ok"
  );
}

/**
 * Records a failed or rejected webhook event.
 *
 * @param provider   - Payment provider identifier.
 * @param eventType  - The webhook event type string (or "unknown" if unparseable).
 * @param durationMs - Processing time before the failure.
 * @param reason     - Short failure reason label (no raw error messages with secrets).
 * @param err        - The underlying error, forwarded to Sentry only.
 */
export function recordWebhookFailure(
  provider: string,
  eventType: string,
  durationMs: number,
  reason: string,
  err?: unknown
): void {
  logger.error(
    { metric: "webhook.event", provider, eventType, status: "error", durationMs, reason },
    "[webhook] processing failed"
  );

  if (err) {
    Sentry.withScope((scope) => {
      scope.setTag("metric", "webhook.event");
      scope.setTag("provider", provider);
      scope.setTag("eventType", eventType);
      scope.setExtra("durationMs", durationMs);
      scope.setExtra("reason", reason);
      Sentry.captureException(err);
    });
  }
}

/**
 * Records a status transition for a gift (e.g. pending_payment → locked).
 * The gift ID is included so events are correlatable in logs, but no
 * personal data (phone, name, amount) is recorded here.
 *
 * @param giftId    - The gift's UUID.
 * @param fromStatus - Previous status.
 * @param toStatus   - New status.
 * @param trigger    - What caused the transition, e.g. "webhook:paystack".
 */
export function recordStatusTransition(
  giftId: string,
  fromStatus: string,
  toStatus: string,
  trigger: string
): void {
  logger.info(
    { metric: "gift.status_transition", giftId, fromStatus, toStatus, trigger },
    "[gift] status changed"
  );
}
