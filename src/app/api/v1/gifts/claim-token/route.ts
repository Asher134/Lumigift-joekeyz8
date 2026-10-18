import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withErrorHandler } from "@/server/middleware";
import { verifyClaimToken } from "@/server/services/claim-token.service";
import type { ApiResponse } from "@/types";

/**
 * GET /api/v1/gifts/claim-token?token=… — resolve an SMS claim link (Issue #366).
 *
 * Requires a session. Returns the gift ID for a valid token, 410 for an expired
 * token and 400 for a malformed or tampered one.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const token = req.nextUrl.searchParams.get("token") ?? "";
  const result = verifyClaimToken(token);

  if (!result.valid) {
    const expired = result.reason === "expired";
    return NextResponse.json<ApiResponse<never>>(
      {
        success: false,
        error: expired
          ? "This claim link has expired. Ask the sender to resend it, or find your gift with your phone number below."
          : "This claim link is invalid. Check the link in your SMS, or find your gift with your phone number below.",
      },
      { status: expired ? 410 : 400 }
    );
  }

  return NextResponse.json<ApiResponse<{ giftId: string }>>({
    success: true,
    data: { giftId: result.giftId },
  });
});
