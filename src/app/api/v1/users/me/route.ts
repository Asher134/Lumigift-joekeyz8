/**
 * GET  /api/v1/users/me — returns the current user's profile and notification preferences.
 * DELETE /api/v1/users/me — account deletion with OTP confirmation and anonymisation.
 *
 * Issue #281: /profile page data source (GET)
 * Issue #280: Account deletion with OTP, anonymisation, audit log (DELETE)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { createHash } from "crypto";
import { z } from "zod";
import pool from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { withErrorHandler, withCsrf } from "@/server/middleware";
import { createAuditLog } from "@/server/services/audit.service";
import { getPreferences } from "@/server/services/notification-preferences.service";
import { getGiftsBySender, cancelGift } from "@/server/services/gift.service";
import type { ApiResponse, GiftStatus } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserProfile {
  id: string;
  phone: string;
  displayName: string | null;
  email?: string | null;
}

interface UserMeResponse {
  user: UserProfile;
  notificationPreferences: Array<{
    channel: "sms" | "email" | "push";
    category: "security" | "lifecycle" | "marketing";
    enabled: boolean;
  }>;
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const deleteSchema = z.object({
  confirmOtp: z.string().regex(/^\d{6}$/, "Enter the 6-digit confirmation code"),
});

// ─── Constants ────────────────────────────────────────────────────────────────

/** Gift statuses that are still active/pending and must be cancelled before deletion. */
const CANCELLABLE_STATUSES = new Set<GiftStatus>([
  "draft",
  "pending_payment",
  "funded",
  "locked",
  "unlocked",
]);

/** Statuses that have funds locked on-chain and need escrow refund logic. */
const ESCROW_STATUSES = new Set<GiftStatus>(["funded", "locked"]);

/** Salt for account-deletion phone hash (separate from gift hash to avoid linking). */
const DELETION_SALT = process.env.ACCOUNT_DELETION_SALT ?? "lumigift-account-deletion-v1";

// ─── GET ──────────────────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: NextRequest) => {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; phone?: string } | undefined;

  if (!user?.id) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  // Fetch user row
  const userResult = await pool.query<{
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
  }>("SELECT id, phone, name, email FROM users WHERE id = $1 AND deleted_at IS NULL", [user.id]);

  if (userResult.rows.length === 0) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "User not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const row = userResult.rows[0];

  // Fetch notification preferences (lazily seeds defaults if missing)
  const prefs = await getPreferences(user.id);

  return NextResponse.json<ApiResponse<UserMeResponse>>({
    success: true,
    data: {
      user: {
        id: row.id,
        phone: row.phone,
        displayName: row.name,
        email: row.email,
      },
      notificationPreferences: prefs.preferences,
    },
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

export const DELETE = withErrorHandler(
  withCsrf(async (req: NextRequest) => {
    const session = await getServerSession(authOptions);
    const sessionUser = session?.user as { id?: string; phone?: string } | undefined;

    if (!sessionUser?.id || !sessionUser.phone) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const userId = sessionUser.id;
    const phone = sessionUser.phone;

    // ── Parse and validate body ──────────────────────────────────────────
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Invalid JSON body", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: parsed.error.issues[0].message, code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const { confirmOtp } = parsed.data;

    // ── OTP confirmation ─────────────────────────────────────────────────
    // Verify the OTP against a recently issued code for this phone.
    const otpResult = await pool.query<{ id: string }>(
      `SELECT id FROM otp_codes
       WHERE phone = $1
         AND code = $2
         AND used = false
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [phone, confirmOtp]
    );

    if (otpResult.rows.length === 0) {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: "Invalid or expired confirmation code",
          code: "VERIFICATION_FAILED",
        },
        { status: 401 }
      );
    }

    // Mark the OTP as used
    await pool.query("UPDATE otp_codes SET used = true WHERE id = $1", [otpResult.rows[0].id]);

    // ── Record deletion request in audit log ─────────────────────────────
    await createAuditLog({
      eventType: "data_deletion_requested",
      userId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim(),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    // ── Cancel active/pending gifts ──────────────────────────────────────
    const gifts = await getGiftsBySender(userId);
    const activeGifts = gifts.filter((g) => CANCELLABLE_STATUSES.has(g.status));

    for (const gift of activeGifts) {
      const refundRequired = ESCROW_STATUSES.has(gift.status);

      if (refundRequired) {
        // Attempt escrow refund — stub if escrow client unavailable.
        try {
          const { triggerEscrowRefund } = (await import("@/lib/escrow-client").catch(
            () => null
          )) ?? { triggerEscrowRefund: null };
          if (triggerEscrowRefund && gift.contractId) {
            await triggerEscrowRefund(gift.contractId);
          }
        } catch {
          // Non-fatal: the gift is still cancelled; ops team can reconcile.
        }
        await cancelGift(gift.id, "pending");
      } else {
        await cancelGift(gift.id, "not_required");
      }
    }

    // ── Anonymise user record ────────────────────────────────────────────
    const anonymisedPhone = createHash("sha256").update(`${DELETION_SALT}:${phone}`).digest("hex");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Overwrite PII — keep the row for referential integrity with financial records.
      await client.query(
        `UPDATE users
         SET phone      = $1,
             name       = NULL,
             email      = NULL,
             deleted_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [`deleted:${anonymisedPhone}`, userId]
      );

      // Remove device fingerprints and notification preferences (not financial).
      await client.query("DELETE FROM known_devices WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM user_notification_preferences WHERE user_id = $1", [userId]);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // ── Write anonymised completion audit log ────────────────────────────
    await createAuditLog({
      eventType: "data_deletion_completed",
      userId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim(),
      userAgent: req.headers.get("user-agent") ?? undefined,
      metadata: {
        cancelledGifts: activeGifts.length,
        anonymised: true,
      },
    });

    return new NextResponse(null, { status: 204 });
  })
);
