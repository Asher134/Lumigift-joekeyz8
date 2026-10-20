import { NextRequest, NextResponse } from "next/server";
import { processUnlocks } from "@/server/services/scheduler.service";
import { startTimer, recordCronSuccess, recordCronFailure } from "@/lib/metrics";
import type { ApiResponse } from "@/types";
import { isAuthorizedCronRequest } from "@/server/cron-auth";

/**
 * GET /api/cron/unlock
 *
 * Triggered by Vercel Cron (or any scheduler) to unlock gifts whose
 * `unlockAt` timestamp has passed.
 *
 * Authentication: Bearer token checked against CRON_SECRET env var.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");

  if (!isAuthorizedCronRequest(authHeader)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const elapsed = startTimer();

  try {
    const unlocked = await processUnlocks();
    const durationMs = elapsed();

    recordCronSuccess("cron/unlock", durationMs, { unlocked });

    return NextResponse.json<ApiResponse<{ unlocked: number }>>({
      success: true,
      data: { unlocked },
    });
  } catch (err) {
    const durationMs = elapsed();
    recordCronFailure("cron/unlock", durationMs, err);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Cron job failed" },
      { status: 500 }
    );
  }
}
