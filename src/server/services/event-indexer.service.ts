/**
 * Escrow event indexer.
 *
 * Fetches Soroban contract events from the RPC node and applies them to the
 * gift database. Processing is idempotent — replaying the same event twice
 * produces the same result.
 *
 * Event → status mapping:
 *   initialized  → locked
 *   claimed      → claimed
 *   cancelled    → cancelled
 *
 * Cursor persistence (issue #76):
 *   The cursor is stored **durably** in the `indexer_cursor` PostgreSQL table
 *   so the indexer survives Redis eviction or pod restarts. Redis is used as a
 *   write-through cache for low-latency reads.
 *
 *   Priority:   Redis (fast) → DB (durable) → CURSOR_GENESIS (cold start)
 *
 * Event log (issue #76):
 *   Every processed event is written to `stellar_event_log` with the outcome
 *   ("applied", "skipped", "error"). The `event_id` column has a UNIQUE
 *   constraint, so INSERT … ON CONFLICT DO NOTHING makes replay idempotent.
 */

import { redis } from "@/lib/redis";
import pool from "@/lib/db";
import { serverConfig } from "@/server/config";
import { fetchEscrowEvents, CURSOR_GENESIS, type EscrowEvent } from "@/lib/contracts/escrow-events";
import { getGiftByContractId, updateGiftStatusIdempotent } from "./gift.service";

const CURSOR_KEY = "escrow:event:cursor";
const INDEXER_NAME = "escrow";

// ─── Outcome type ─────────────────────────────────────────────────────────────

type EventOutcome = "applied" | "skipped" | "error";

// ─── Public API ───────────────────────────────────────────────────────────────

export interface IndexEventsResult {
  processed: number;
  skipped: number;
  latestCursor: string;
}

/**
 * Runs one indexing pass: fetches events since the last cursor, applies them
 * to the DB, and persists the new cursor.
 *
 * Safe to call from a cron job — duplicate events are rejected by the
 * `event_id` UNIQUE constraint in `stellar_event_log` (idempotent).
 */
export async function indexEscrowEvents(): Promise<IndexEventsResult> {
  const rpcUrl =
    process.env.STELLAR_RPC_URL ??
    (serverConfig.stellar.network === "mainnet"
      ? "https://soroban-rpc.stellar.org"
      : "https://soroban-testnet.stellar.org");

  const contractId = serverConfig.stellar.escrowContractId;
  if (!contractId) {
    console.warn("[event-indexer] STELLAR_ESCROW_CONTRACT_ID not set — skipping");
    return { processed: 0, skipped: 0, latestCursor: CURSOR_GENESIS };
  }

  // ── Cursor resolution: Redis → DB → genesis ──────────────────────────────
  const startCursor = await resolveCursor();

  const { events, latestCursor } = await fetchEscrowEvents({
    rpcUrl,
    contractId,
    startCursor,
    limit: 200,
  });

  let processed = 0;
  let skipped = 0;

  for (const event of events) {
    const outcome = await applyEvent(event);
    if (outcome === "applied") processed++;
    else skipped++;
  }

  // ── Persist cursor even if no events — advances the ledger window ─────────
  if (latestCursor !== startCursor) {
    await persistCursor(latestCursor);
  }

  return { processed, skipped, latestCursor };
}

// ─── Cursor persistence ───────────────────────────────────────────────────────

/**
 * Resolves the current indexer cursor.
 * Read order: Redis (fast) → PostgreSQL `indexer_cursor` (durable) → genesis.
 */
async function resolveCursor(): Promise<string> {
  // 1. Try Redis first (low latency)
  const redisCursor = await redis.get(CURSOR_KEY);
  if (redisCursor) return redisCursor;

  // 2. Fall back to durable DB cursor
  try {
    const result = await pool.query<{ cursor: string }>(
      "SELECT cursor FROM indexer_cursor WHERE indexer_name = $1",
      [INDEXER_NAME]
    );
    if (result.rows.length > 0) {
      const dbCursor = result.rows[0].cursor;
      // Warm Redis cache
      await redis.set(CURSOR_KEY, dbCursor).catch(() => {
        // Redis write failure is non-fatal
      });
      return dbCursor;
    }
  } catch (err) {
    console.warn("[event-indexer] failed to read cursor from DB:", (err as Error).message);
  }

  // 3. Cold start
  return CURSOR_GENESIS;
}

/**
 * Persists the cursor to both Redis and PostgreSQL.
 * Redis failure is non-fatal (DB is the source of truth).
 */
async function persistCursor(cursor: string): Promise<void> {
  // Write to DB first (source of truth)
  try {
    await pool.query(
      `INSERT INTO indexer_cursor (indexer_name, cursor, last_ledger, updated_at)
       VALUES ($1, $2, 0, NOW())
       ON CONFLICT (indexer_name) DO UPDATE
         SET cursor = EXCLUDED.cursor, updated_at = NOW()`,
      [INDEXER_NAME, cursor]
    );
  } catch (err) {
    console.error("[event-indexer] failed to persist cursor to DB:", (err as Error).message);
    // Do not throw — we still want to update Redis
  }

  // Update Redis cache
  await redis.set(CURSOR_KEY, cursor).catch((err: unknown) => {
    console.warn("[event-indexer] failed to write cursor to Redis:", (err as Error).message);
  });
}

// ─── Event application ────────────────────────────────────────────────────────

/**
 * Applies a single event to the gift DB and writes a record to `stellar_event_log`.
 * Returns the outcome: "applied", "skipped", or "error".
 */
async function applyEvent(event: EscrowEvent): Promise<EventOutcome> {
  let giftId: string | null = null;
  let outcome: EventOutcome = "skipped";
  let errorMessage: string | undefined;

  try {
    const gift = await getGiftByContractId(event.contractId);
    giftId = gift?.id ?? null;

    if (!gift) {
      console.debug(`[event-indexer] no gift found for contractId=${event.contractId}, skipping`);
      outcome = "skipped";
    } else {
      switch (event.type) {
        case "initialized": {
          if (gift.status === "locked") {
            outcome = "skipped";
          } else {
            await updateGiftStatusIdempotent(gift.id, "locked");
            console.log(`[event-indexer] initialized → locked  gift=${gift.id} tx=${event.txHash}`);
            outcome = "applied";
          }
          break;
        }

        case "claimed": {
          if (gift.status === "claimed") {
            outcome = "skipped";
          } else {
            await updateGiftStatusIdempotent(gift.id, "claimed");
            console.log(`[event-indexer] claimed → claimed  gift=${gift.id} tx=${event.txHash}`);
            outcome = "applied";
          }
          break;
        }

        case "cancelled": {
          if (gift.status === "cancelled") {
            outcome = "skipped";
          } else {
            await updateGiftStatusIdempotent(gift.id, "cancelled");
            console.log(`[event-indexer] cancelled → cancelled  gift=${gift.id} tx=${event.txHash}`);
            outcome = "applied";
          }
          break;
        }

        default: {
          const _exhaustive: never = event;
          outcome = "skipped";
        }
      }
    }
  } catch (err) {
    outcome = "error";
    errorMessage = (err as Error).message;
    console.error(`[event-indexer] error applying event ${event.txHash}:`, errorMessage);
  }

  // ── Persist event log record (idempotent via ON CONFLICT DO NOTHING) ─────
  await persistEventLog(event, giftId, outcome, errorMessage);

  return outcome;
}

/**
 * Writes a record to `stellar_event_log`. Uses ON CONFLICT DO NOTHING on
 * `event_id` so replaying the same event is always safe.
 */
async function persistEventLog(
  event: EscrowEvent,
  giftId: string | null,
  outcome: EventOutcome,
  errorMessage?: string
): Promise<void> {
  // Build a JSON-serialisable payload (bigint → string)
  const payload = buildPayload(event);

  try {
    await pool.query(
      `INSERT INTO stellar_event_log
         (event_id, contract_id, ledger, ledger_closed_at, tx_hash,
          event_type, gift_id, outcome, error_message, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        // Use Soroban event id as the unique key: "{ledger}-{tx_index}"
        // The event object from escrow-events uses txHash + ledger as identity
        `${event.ledger}-${event.txHash}`,
        event.contractId,
        event.ledger,
        event.ledgerClosedAt ?? null,
        event.txHash,
        event.type,
        giftId,
        outcome,
        errorMessage ?? null,
        JSON.stringify(payload),
      ]
    );
  } catch (err) {
    // Log persistence failure but don't block the indexer
    console.error("[event-indexer] failed to persist event log:", (err as Error).message);
  }
}

/**
 * Converts an EscrowEvent to a plain JSON-serialisable object.
 * BigInt values are serialised as strings to avoid JSON.stringify errors.
 */
function buildPayload(event: EscrowEvent): Record<string, unknown> {
  switch (event.type) {
    case "initialized":
      return {
        type: event.type,
        sender: event.sender,
        recipient: event.recipient,
        amount: event.amount.toString(),
        unlockTime: event.unlockTime.toString(),
      };
    case "claimed":
      return {
        type: event.type,
        recipient: event.recipient,
        amount: event.amount.toString(),
      };
    case "cancelled":
      return {
        type: event.type,
        sender: event.sender,
        amount: event.amount.toString(),
      };
  }
}
