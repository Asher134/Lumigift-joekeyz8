import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withErrorHandler, rateLimit } from "@/server/middleware";
import { exportUserData, type DataExport } from "@/server/services/privacy.service";
import type { ApiResponse } from "@/types";

// Exports are expensive and contain everything we hold — 5 per user per day.
const EXPORT_LIMIT = 5;
const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/v1/users/me/export — subject access request (Issue #145).
 * Returns a JSON download of all data held about the signed-in user.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; phone?: string } | undefined;
  if (!user?.id || !user.phone) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  if (!rateLimit(`privacy:export:${user.id}`, EXPORT_LIMIT, EXPORT_WINDOW_MS)) {
    return NextResponse.json<ApiResponse<never>>(
      {
        success: false,
        error: "Export limit reached. Try again tomorrow.",
        code: "RATE_LIMIT_EXCEEDED",
      },
      { status: 429 }
    );
  }

  const data = await exportUserData({
    userId: user.id,
    phone: user.phone,
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim(),
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  const res = NextResponse.json<ApiResponse<DataExport>>({ success: true, data });
  res.headers.set("Content-Disposition", 'attachment; filename="lumigift-data-export.json"');
  res.headers.set("Cache-Control", "no-store");
  return res;
});
