import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withErrorHandler, rateLimit } from "@/server/middleware";
import type { ApiResponse } from "@/types";

// Per-user: 20 lookups per hour. The lookup is only needed while composing a
// gift, so this is generous for real use but stops bulk enumeration.
const LOOKUP_LIMIT = 20;
const LOOKUP_WINDOW_MS = 60 * 60 * 1000;

/**
 * GET /api/v1/users?phone= — whether a phone number is registered.
 *
 * Requires a session and is rate limited per user: unauthenticated access made
 * this a free phone-number enumeration oracle (pentest finding PT-02).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  if (!rateLimit(`users:lookup:${userId}`, LOOKUP_LIMIT, LOOKUP_WINDOW_MS)) {
    return NextResponse.json<ApiResponse<never>>(
      {
        success: false,
        error: "Too many lookups. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(req.url);
  const phoneParam = searchParams.get("phone");
  if (!phoneParam) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Phone parameter required" },
      { status: 400 }
    );
  }

  const phone = normalizePhone(phoneParam);
  if (!phone) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Invalid phone number" },
      { status: 400 }
    );
  }

  const { rows } = await pool.query("SELECT 1 FROM users WHERE phone = $1 LIMIT 1", [phone]);

  return NextResponse.json<ApiResponse<{ exists: boolean }>>({
    success: true,
    data: { exists: rows.length > 0 },
  });
});
