import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withErrorHandler } from "@/server/middleware";
import { getRedisClient } from "@/lib/redis";
import type { ApiResponse } from "@/types";

/**
 * GET /api/v1/users/me/export/download?token=…
 *
 * Serves a previously-requested data export. The payload is stored in Redis
 * with a 24-hour TTL (set by the export endpoint) and is scoped to the
 * requesting user, so a token alone is not sufficient — the caller must be
 * the same authenticated user who initiated the export.
 *
 * Returns 410 Gone when the download link has expired or was already consumed.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Download token required" },
      { status: 400 }
    );
  }

  const redis = await getRedisClient();
  const raw = await redis.get(`data-export:${user.id}:${token}`);

  if (!raw) {
    return NextResponse.json<ApiResponse<never>>(
      {
        success: false,
        error: "Download link not found or has expired",
        code: "EXPORT_NOT_FOUND",
      },
      { status: 410 }
    );
  }

  // Consume the export so the single-use link cannot be re-downloaded
  // indefinitely. The TTL still bounds the window to 24 hours.
  await redis.del(`data-export:${user.id}:${token}`);

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Export payload is corrupt", code: "EXPORT_CORRUPT" },
      { status: 500 }
    );
  }

  const res = NextResponse.json(data);
  res.headers.set("Content-Disposition", 'attachment; filename="lumigift-data-export.json"');
  res.headers.set("Content-Type", "application/json");
  res.headers.set("Cache-Control", "no-store");
  return res;
});
