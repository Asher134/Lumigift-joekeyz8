/**
 * GET  /api/v1/support/cases/:caseReference — Fetch one of the user's cases (marks replies read)
 * POST /api/v1/support/cases/:caseReference — Add a user message to the case thread
 *
 * Issue #347 — In-app chat support widget.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withAuth, withErrorHandler, AppError, ERROR_CODES } from "@/server/middleware";
import {
  addSupportCaseMessage,
  getSupportCase,
  markSupportCaseRead,
} from "@/server/services/support.service";
import type { ApiResponse, SupportCase } from "@/types";

type Context = { params: Promise<{ caseReference: string }> };

async function getOwnedCase(context: unknown): Promise<SupportCase> {
  const session = await getServerSession(authOptions);
  const userId = (session!.user as { id: string }).id;
  const { caseReference } = await (context as Context).params;

  const supportCase = getSupportCase(caseReference);
  if (!supportCase || supportCase.userId !== userId) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "Support case not found", 404);
  }
  return supportCase;
}

export const GET = withErrorHandler(
  withAuth(async (_req: NextRequest, context?: unknown) => {
    const supportCase = await getOwnedCase(context);
    markSupportCaseRead(supportCase.caseReference);
    return NextResponse.json<ApiResponse<SupportCase>>({ success: true, data: supportCase });
  })
);

/** Body: `{ body: string }` */
export const POST = withErrorHandler(
  withAuth(async (req: NextRequest, context?: unknown) => {
    const supportCase = await getOwnedCase(context);
    const payload = await req.json().catch(() => null);

    if (!payload || typeof payload.body !== "string" || !payload.body.trim()) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "body is required", 400);
    }

    const updated = addSupportCaseMessage(supportCase.caseReference, "user", payload.body.trim());
    return NextResponse.json<ApiResponse<SupportCase>>(
      { success: true, data: updated! },
      { status: 201 }
    );
  })
);
