/**
 * POST /api/v1/admin/support/:caseReference — Post an agent reply to a support case
 *
 * Admin-only. Issue #347 — In-app chat support widget.
 */
import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler, AppError, ERROR_CODES } from "@/server/middleware";
import { requireAdmin } from "@/server/middleware/admin";
import { addSupportCaseMessage } from "@/server/services/support.service";
import type { ApiResponse, SupportCase } from "@/types";

/** Body: `{ body: string }` */
export const POST = withErrorHandler(async (req: NextRequest, context?: unknown) => {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { caseReference } = await (context as { params: Promise<{ caseReference: string }> })
    .params;
  const payload = await req.json().catch(() => null);

  if (!payload || typeof payload.body !== "string" || !payload.body.trim()) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "body is required", 400);
  }

  const updated = addSupportCaseMessage(caseReference, "agent", payload.body.trim());
  if (!updated) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "Support case not found", 404);
  }

  return NextResponse.json<ApiResponse<SupportCase>>({ success: true, data: updated });
});
