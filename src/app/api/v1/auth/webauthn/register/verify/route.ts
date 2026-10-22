/**
 * POST /api/v1/auth/webauthn/register/verify — Complete passkey registration
 *
 * Body: the `RegistrationResponseJSON` returned by `startRegistration()`.
 * Issue #346 — Biometric authentication via WebAuthn.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withAuth, withErrorHandler, AppError, ERROR_CODES } from "@/server/middleware";
import { verifyRegistration } from "@/lib/webauthn";

export const POST = withErrorHandler(
  withAuth(async (req: NextRequest) => {
    const session = await getServerSession(authOptions);
    const userId = (session!.user as { id: string }).id;

    const body = await req.json().catch(() => null);
    if (!body || typeof body.id !== "string") {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Invalid registration response", 400);
    }

    const verified = await verifyRegistration(userId, body);
    if (!verified) {
      throw new AppError(ERROR_CODES.VERIFICATION_FAILED, "Passkey registration failed", 400);
    }
    return NextResponse.json({ success: true, data: { registered: true } });
  })
);
