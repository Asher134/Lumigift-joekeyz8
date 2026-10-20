import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { withErrorHandler, withCsrf } from "@/server/middleware";
import { deleteUserData } from "@/server/services/privacy.service";
import type { ApiResponse } from "@/types";

const deleteSchema = z.object({ otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });

/**
 * DELETE /api/v1/users/me — account erasure request (Issue #145).
 *
 * Body: `{ otp }` — a fresh code from `POST /api/v1/auth/send-otp`, so a
 * hijacked session cookie alone cannot erase an account.
 */
export const DELETE = withErrorHandler(
  withCsrf(async (req: NextRequest) => {
    const session = await getServerSession(authOptions);
    const user = session?.user as { id?: string; phone?: string } | undefined;
    if (!user?.id || !user.phone) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: parsed.error.issues[0].message, code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    await deleteUserData(
      {
        userId: user.id,
        phone: user.phone,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim(),
        userAgent: req.headers.get("user-agent") ?? undefined,
      },
      parsed.data.otp
    );

    return NextResponse.json<ApiResponse<{ deleted: true }>>({
      success: true,
      data: { deleted: true },
    });
  })
);
