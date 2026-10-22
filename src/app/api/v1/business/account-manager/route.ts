/**
 * GET /api/v1/business/account-manager — Dedicated account manager contact
 *
 * Issue #345 — Business/corporate gifting tier.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withAuth, withErrorHandler } from "@/server/middleware";
import {
  assertBusinessAccount,
  getAccountManagerContact,
} from "@/server/services/business.service";

export const GET = withErrorHandler(
  withAuth(async (_req: NextRequest) => {
    const session = await getServerSession(authOptions);
    const userId = (session!.user as { id: string }).id;
    await assertBusinessAccount(userId);

    return NextResponse.json({ success: true, data: getAccountManagerContact() });
  })
);
