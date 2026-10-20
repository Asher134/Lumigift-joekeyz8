import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { withErrorHandler, withCsrf, rateLimit } from "@/server/middleware";
import {
  discoverGiftsForRecipient,
  verificationFailed,
  type DiscoveredGift,
} from "@/server/services/claim-discovery.service";
import type { ApiResponse } from "@/types";

const discoverSchema = z.object({
  phone: z.string().min(1).max(32),
  otp: z.string().regex(/^\d{6}$/),
});

// Per-IP: 10 discovery attempts per 10 minutes (OTP itself locks after 5 bad codes)
const IP_LIMIT = 10;
const IP_WINDOW_MS = 10 * 60 * 1000;

/**
 * POST /api/v1/gifts/discover — recipient claim discovery (Issue #148).
 *
 * Body: `{ phone, otp }`. Returns the gifts addressed to `phone` once the OTP
 * is verified. Malformed input, unknown numbers and wrong codes all return the
 * identical 401 body so the endpoint never reveals whether a gift exists.
 */
export const POST = withErrorHandler(
  withCsrf(async (req: NextRequest) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    if (!rateLimit(`discover:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS)) {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: "Too many attempts. Please try again later.",
          code: "RATE_LIMIT_EXCEEDED",
        },
        { status: 429 }
      );
    }

    const parsed = discoverSchema.safeParse(await req.json().catch(() => null));
    const phone = parsed.success ? normalizePhone(parsed.data.phone) : null;
    if (!parsed.success || !phone) throw verificationFailed();

    const gifts = await discoverGiftsForRecipient(phone, parsed.data.otp);

    return NextResponse.json<ApiResponse<{ gifts: DiscoveredGift[] }>>({
      success: true,
      data: { gifts },
    });
  })
);
