import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withErrorHandler, rateLimit } from "@/server/middleware";
import { exportUserData, type DataExport } from "@/server/services/privacy.service";
import { getRedisClient } from "@/lib/redis";
import type { ApiResponse } from "@/types";

// Exports are expensive and contain everything we hold — 1 export per user per 24 hours.
const EXPORT_LIMIT = 1;
const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
// Download links expire after 24 hours.
const DOWNLOAD_TTL_SECONDS = 24 * 60 * 60;

function generateDownloadToken(): string {
  return crypto.randomUUID();
}

/**
 * GET /api/v1/users/me/export — subject access request (Issue #145).
 *
 * Generates a machine-readable export of all data held about the signed-in
 * user (gifts, transactions, audit logs, preferences, …) and returns a
 * short-lived download link instead of streaming the payload inline.
 *
 * The export is generated asynchronously: the payload is written to Redis
 * with a 24-hour TTL and the client receives a download URL. Recipient phone
 * hashes are never included (irreversible by design).
 *
 * Rate limited to 1 export per user per 24 hours. Every request is recorded
 * in `data_subject_requests` and an audit log entry is created.
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

  const data: DataExport = await exportUserData({
    userId: user.id,
    phone: user.phone,
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim(),
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  // Store the payload in Redis so the client can download it later. The key
  // is scoped to the requesting user so a leaked token cannot be used by
  // another user; authorization is re-checked on download.
  const token = generateDownloadToken();
  const redis = await getRedisClient();
  await redis.set(
    `data-export:${user.id}:${token}`,
    JSON.stringify({ data, generatedAt: data.generatedAt }),
    { EX: DOWNLOAD_TTL_SECONDS }
  );

  const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString();
  const downloadUrl = `${req.nextUrl.origin}/api/v1/users/me/export/download?token=${token}`;

  const res = NextResponse.json<ApiResponse<{ downloadUrl: string; expiresAt: string }>>({
    success: true,
    data: { downloadUrl, expiresAt },
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
