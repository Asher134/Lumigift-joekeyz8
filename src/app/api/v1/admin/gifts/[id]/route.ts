import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler, rateLimit } from "@/server/middleware";
import { requireAdmin } from "@/server/middleware/admin";
import { adminGetGift, logAdminAction } from "@/server/services/admin-gift.service";
import { setGiftGracePeriod } from "@/server/services/scheduler.service";
import type { ApiResponse, Gift } from "@/types";

export const GET = withErrorHandler(async (req: NextRequest, context: unknown) => {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  if (!rateLimit(`admin:${auth.userId}`, 60, 60_000)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Too many requests", code: "RATE_LIMITED" },
      { status: 429 }
    );
  }

  const { params } = context as { params: { id: string } };
  const gift = adminGetGift(params.id);

  if (!gift) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Gift not found" },
      { status: 404 }
    );
  }

  logAdminAction(auth.userId, "view_gift", gift.id);

  return NextResponse.json<ApiResponse<Gift>>({ success: true, data: gift });
});

/**
 * PATCH /api/v1/admin/gifts/:id
 *
 * Waives (`graceDays: 0`) or shortens the expiry grace period for a gift in
 * `expired_pending_refund`. Body: `{ "graceDays": number }`.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, context: unknown) => {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { params } = context as { params: { id: string } };
  const body = (await req.json().catch(() => null)) as { graceDays?: unknown } | null;
  const graceDays = body?.graceDays;

  if (typeof graceDays !== "number" || !Number.isInteger(graceDays) || graceDays < 0) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "graceDays must be a non-negative integer" },
      { status: 400 }
    );
  }

  const updated = await setGiftGracePeriod(params.id, graceDays);
  if (!updated) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Gift not found or not in grace period" },
      { status: 404 }
    );
  }

  logAdminAction(auth.userId, `set_grace_period:${graceDays}`, params.id);

  return NextResponse.json<ApiResponse<{ giftId: string; graceDays: number }>>({
    success: true,
    data: { giftId: params.id, graceDays },
  });
});
