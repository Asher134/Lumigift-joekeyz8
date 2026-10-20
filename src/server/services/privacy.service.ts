import pool from "@/lib/db";
import { verifyOtp } from "@/lib/otp";
import { AppError } from "@/server/errors";
import { createAuditLog } from "./audit.service";
import {
  getGiftsBySender,
  getGiftsByRecipient,
  hashPhone,
  redactGiftsForErasedSender,
} from "./gift.service";
import type { Gift, GiftStatus } from "@/types";

/**
 * Data subject access (export) and erasure (deletion) workflows — Issue #145.
 *
 * Both workflows:
 *  - run only for the authenticated user, on their own data;
 *  - are recorded in `data_subject_requests` *and* the append-only `audit_logs`;
 *  - keep the financial records we are legally required to retain.
 *
 * Retention exceptions are documented in
 * docs/security/data-retention-and-subject-access.md.
 */

export interface RequestContext {
  userId: string;
  phone: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Sender-side statuses that still have money in flight — erasure must wait. */
const ACTIVE_GIFT_STATUSES: ReadonlySet<GiftStatus> = new Set<GiftStatus>([
  "pending_payment",
  "funded",
  "locked",
  "unlocked",
]);

export const EXPORT_FORMAT_VERSION = "1";

export interface DataExport {
  formatVersion: string;
  generatedAt: string;
  profile: Record<string, unknown> | null;
  notificationPreferences: Record<string, unknown>[];
  knownDevices: Record<string, unknown>[];
  giftsSent: Gift[];
  giftsReceived: Omit<Gift, "recipientPhoneHash" | "senderId">[];
  auditTrail: Record<string, unknown>[];
  dataSubjectRequests: Record<string, unknown>[];
}

async function recordRequest(
  ctx: RequestContext,
  requestType: "export" | "deletion",
  status: "completed" | "rejected",
  reason?: string
): Promise<void> {
  await pool.query(
    "INSERT INTO data_subject_requests (user_id, request_type, status, reason, ip_address, user_agent, completed_at) VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $3 = 'completed' THEN NOW() END)",
    [ctx.userId, requestType, status, reason ?? null, ctx.ipAddress ?? null, ctx.userAgent ?? null]
  );
}

/**
 * Builds a machine-readable export of everything we hold about the user.
 * Gifts received are projected without the sender's ID so the export never
 * discloses another person's identifiers.
 */
export async function exportUserData(ctx: RequestContext): Promise<DataExport> {
  const [profile, prefs, devices, audit, requests] = await Promise.all([
    pool.query(
      "SELECT id, phone, name, role, created_at, updated_at FROM users WHERE id = $1 AND deleted_at IS NULL",
      [ctx.userId]
    ),
    pool.query(
      "SELECT channel, category, enabled, updated_at FROM user_notification_preferences WHERE user_id = $1",
      [ctx.userId]
    ),
    pool.query(
      "SELECT fingerprint, last_seen_at, created_at FROM known_devices WHERE user_id = $1",
      [ctx.userId]
    ),
    pool.query(
      "SELECT event_type, gift_id, amount_ngn, amount_usdc, timestamp, metadata FROM audit_logs WHERE user_id = $1 ORDER BY timestamp DESC",
      [ctx.userId]
    ),
    pool.query(
      "SELECT request_type, status, reason, requested_at, completed_at FROM data_subject_requests WHERE user_id = $1 ORDER BY requested_at DESC",
      [ctx.userId]
    ),
  ]);

  const giftsSent = await getGiftsBySender(ctx.userId);
  const giftsReceived = (await getGiftsByRecipient(ctx.phone)).map(
    ({ recipientPhoneHash: _h, senderId: _s, ...rest }) => rest
  );

  await recordRequest(ctx, "export", "completed");
  await createAuditLog({
    eventType: "data_export_requested",
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    profile: profile.rows[0] ?? null,
    notificationPreferences: prefs.rows,
    knownDevices: devices.rows,
    giftsSent,
    giftsReceived,
    auditTrail: audit.rows,
    dataSubjectRequests: requests.rows,
  };
}

async function rejectDeletion(
  ctx: RequestContext,
  reason: string,
  error: AppError
): Promise<never> {
  await recordRequest(ctx, "deletion", "rejected", reason);
  await createAuditLog({
    eventType: "data_deletion_rejected",
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { reason },
  });
  throw error;
}

/**
 * Erases the user's personal data after re-verifying phone ownership with a
 * fresh OTP. Financial records are pseudonymised rather than deleted.
 *
 * @throws {@link AppError} `VERIFICATION_FAILED` (401) if the OTP is wrong.
 * @throws {@link AppError} `ACCOUNT_HAS_ACTIVE_GIFTS` (409) while any sent gift
 *   still has money in flight — the user must cancel or wait for it to settle.
 */
export async function deleteUserData(ctx: RequestContext, otp: string): Promise<void> {
  await createAuditLog({
    eventType: "data_deletion_requested",
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  const verification = await verifyOtp(ctx.phone, otp);
  if (!verification.success) {
    await rejectDeletion(
      ctx,
      "verification_failed",
      new AppError("VERIFICATION_FAILED", "We couldn't verify that code. Please try again.", 401)
    );
  }

  const active = (await getGiftsBySender(ctx.userId)).filter((g) =>
    ACTIVE_GIFT_STATUSES.has(g.status)
  );
  if (active.length > 0) {
    await rejectDeletion(
      ctx,
      "active_gifts",
      new AppError(
        "ACCOUNT_HAS_ACTIVE_GIFTS",
        `You have ${active.length} gift(s) still in progress. Cancel them or wait until they are claimed before deleting your account.`,
        409
      )
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM user_notification_preferences WHERE user_id = $1", [
      ctx.userId,
    ]);
    await client.query("DELETE FROM known_devices WHERE user_id = $1", [ctx.userId]);
    await client.query("DELETE FROM suspicious_login_reports WHERE user_id = $1", [ctx.userId]);
    // Plaintext phone on invitations addressed to this user; the hash stays for audit.
    await client.query(
      "UPDATE gift_invitations SET recipient_phone = '[redacted]' WHERE recipient_phone_hash = $1",
      [hashPhone(ctx.phone)]
    );
    // Overwrite PII but keep the row so gifts/payments/audit logs stay linked.
    await client.query(
      "UPDATE users SET phone = 'deleted:' || id, name = 'Deleted user', deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
      [ctx.userId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const redactedGifts = await redactGiftsForErasedSender(ctx.userId);

  await recordRequest(ctx, "deletion", "completed");
  await createAuditLog({
    eventType: "data_deletion_completed",
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { redactedGifts },
  });
}
