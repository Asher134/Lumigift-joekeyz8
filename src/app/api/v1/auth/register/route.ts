import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { withErrorHandler, withCsrf, validateBody } from "@/server/middleware";
import { validateInvitationToken, acceptInvitation } from "@/server/services/invitation.service";
import { createHash, randomUUID } from "crypto";
import { registerSchema } from "@/types/schemas";
import type { ApiResponse } from "@/types";

/** Generic message — must not confirm whether the phone is already registered. */
const DUPLICATE_ERROR = "Unable to register with the provided details";

const PG_UNIQUE_VIOLATION = "23505";

function hashPhone(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}

function duplicateResponse() {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error: DUPLICATE_ERROR },
    { status: 409 }
  );
}

export const POST = withErrorHandler(
  withCsrf(async (req: NextRequest) => {
    const validation = await validateBody(req, registerSchema);
    if (!validation.success) return validation.response;
    const { phone, displayName, invitationToken } = validation.data;
    const phoneHash = hashPhone(phone);

    const { rows: existingUsers } = await pool.query(
      "SELECT 1 FROM users WHERE phone_hash = $1 AND deleted_at IS NULL LIMIT 1",
      [phoneHash]
    );
    if (existingUsers.length > 0) return duplicateResponse();

    let invitationId: string | null = null;
    if (invitationToken) {
      const invitation = await validateInvitationToken(invitationToken);
      if (!invitation) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "Invalid or expired invitation" },
          { status: 400 }
        );
      }

      if (invitation.recipientPhone !== phone) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "Phone number does not match invitation" },
          { status: 400 }
        );
      }

      invitationId = invitation.id;
    }

    const userId = randomUUID();
    try {
      await pool.query(
        "INSERT INTO users (id, phone, phone_hash, display_name) VALUES ($1, $2, $3, $4)",
        [userId, phone, phoneHash, displayName]
      );
    } catch (error) {
      // Concurrent registration with the same phone hits the unique index.
      if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) return duplicateResponse();
      console.error("[register] Error creating user:", error);
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Failed to create user account" },
        { status: 500 }
      );
    }

    if (invitationId) await acceptInvitation(invitationId);

    return NextResponse.json<ApiResponse<{ userId: string; phone: string }>>(
      { success: true, data: { userId, phone } },
      { status: 201 }
    );
  })
);
