/**
 * POST /api/v1/business/bulk-gifts — Create a bulk gift order from a CSV upload
 *
 * Accepts `multipart/form-data` with a `file` field, or a raw `text/csv` body.
 * All recipients are paid for with a single Paystack charge.
 * Issue #345 — Business/corporate gifting tier.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withAuth, withErrorHandler, AppError, ERROR_CODES } from "@/server/middleware";
import {
  assertBusinessAccount,
  createBulkGiftOrder,
  parseRecipientsCsv,
} from "@/server/services/business.service";

export const POST = withErrorHandler(
  withAuth(async (req: NextRequest) => {
    const session = await getServerSession(authOptions);
    const userId = (session!.user as { id: string }).id;
    await assertBusinessAccount(userId);

    let csv: string;
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof Blob)) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, "A CSV file is required", 400);
      }
      csv = await file.text();
    } else {
      csv = await req.text();
    }

    const { items, errors } = parseRecipientsCsv(csv);
    if (errors.length > 0) {
      return NextResponse.json(
        { success: false, error: "CSV contains invalid rows", code: "VALIDATION_ERROR", errors },
        { status: 400 }
      );
    }

    const { order, paymentUrl } = await createBulkGiftOrder(userId, items);
    return NextResponse.json(
      {
        success: true,
        data: { orderId: order.id, totalNgn: order.totalNgn, recipients: items.length, paymentUrl },
      },
      { status: 201 }
    );
  })
);
