import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGiftById } from "@/server/services/gift.service";
import {
  getCancellationEligibility,
  type CancellationEligibility,
} from "@/server/services/cancellation.service";
import { withErrorHandler } from "@/server/middleware";
import type { ApiResponse } from "@/types";

/**
 * GET /api/v1/gifts/[id]/cancel — previews whether the sender may cancel the
 * gift and what the consequences are. The cancellation itself is
 * `DELETE /api/v1/gifts/[id]`.
 */
export const GET = withErrorHandler(async (_req: NextRequest, context: unknown) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { params } = context as { params: { id: string } };
  const gift = await getGiftById(params.id);
  const userId = (session.user as { id: string }).id;

  if (!gift || gift.senderId !== userId) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Gift not found" },
      { status: 404 }
    );
  }

  return NextResponse.json<ApiResponse<CancellationEligibility>>({
    success: true,
    data: getCancellationEligibility(gift),
  });
});
