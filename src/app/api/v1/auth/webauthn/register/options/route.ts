/**
 * POST /api/v1/auth/webauthn/register/options — Begin passkey registration
 *
 * Requires an authenticated session (registration is offered after OTP login).
 * Issue #346 — Biometric authentication via WebAuthn.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withAuth, withErrorHandler } from "@/server/middleware";
import { createRegistrationOptions } from "@/lib/webauthn";

export const POST = withErrorHandler(
  withAuth(async (_req: NextRequest) => {
    const session = await getServerSession(authOptions);
    const user = session!.user as { id: string; phone: string };

    const options = await createRegistrationOptions(user.id, user.phone);
    return NextResponse.json({ success: true, data: options });
  })
);
