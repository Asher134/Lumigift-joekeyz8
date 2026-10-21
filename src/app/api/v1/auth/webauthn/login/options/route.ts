/**
 * POST /api/v1/auth/webauthn/login/options — Begin passkey sign-in
 *
 * Body: `{ phone: string }`. Returns 404 when no passkey is registered so the
 * client can fall back to OTP.
 * Issue #346 — Biometric authentication via WebAuthn.
 */
import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler, AppError, ERROR_CODES } from "@/server/middleware";
import pool from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { createAuthenticationOptions } from "@/lib/webauthn";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const phone = typeof body?.phone === "string" ? normalizePhone(body.phone) : null;
  if (!phone) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "A valid phone number is required", 400);
  }

  const { rows } = await pool.query<{ id: string }>("SELECT id FROM users WHERE phone = $1", [
    phone,
  ]);
  const options = rows[0] ? await createAuthenticationOptions(rows[0].id) : null;
  if (!options) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "No passkey registered", 404);
  }

  return NextResponse.json({ success: true, data: options });
});
