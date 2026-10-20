import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGiftById, hashPhone } from "@/server/services/gift.service";
import { cancelGiftForSender } from "@/server/services/cancellation.service";
import { withErrorHandler, withCsrf } from "@/server/middleware";
import type { ApiResponse, Gift } from "@/types";

export const GET = withErrorHandler(async (_req: NextRequest, context: unknown) => {
  const { params } = context as { params: { id: string } };
  const gift = await getGiftById(params.id);

  if (!gift) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Gift not found" },
      { status: 404 }
    );
  }

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const phone = (session?.user as { phone?: string } | undefined)?.phone;
  const recipientPhoneHash = phone ? hashPhone(phone) : undefined;

  const isSender = !!userId && gift.senderId === userId;
  const isRecipient = !!recipientPhoneHash && gift.recipientPhoneHash === recipientPhoneHash;

  if (!isSender && !isRecipient) {
    // Unauthenticated or unrelated users only see public claim-page fields
    // Amount, message and media stay hidden until unlock so a shared link
    // can't spoil the surprise (pentest finding PT-03).
    const revealed = gift.status === "unlocked" || gift.status === "claimed";
    const safeGift: Partial<Gift> = {
      id: gift.id,
      recipientName: gift.recipientName,
      unlockAt: gift.unlockAt,
      status: gift.status,
      ...(revealed
        ? { amountNgn: gift.amountNgn, message: gift.message, mediaUrl: gift.mediaUrl }
        : {}),
    };
    return NextResponse.json<ApiResponse<Partial<Gift>>>({
      success: true,
      data: safeGift,
    });
  }

  // Sender or recipient gets the full gift (minus phone hash)
  const { recipientPhoneHash: _omit, ...fullGift } = gift;
  return NextResponse.json<ApiResponse<Omit<Gift, "recipientPhoneHash">>>({
    success: true,
    data: fullGift,
  });
});

export const DELETE = withErrorHandler(
  withCsrf(async (_req: NextRequest, context: unknown) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { params } = context as { params: { id: string } };
    const gift = await getGiftById(params.id);

    if (!gift) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Gift not found" },
        { status: 404 }
      );
    }

    const userId = (session.user as { id: string }).id;
    // 404 rather than 403 so non-senders can't distinguish other people's gifts
    if (gift.senderId !== userId) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    // Cancellable statuses mirror the on-chain contract behaviour:
    //   - pending_payment: NGN received but USDC not yet locked
    //   - funded: USDC funding in progress, contract not yet initialised
    //   - locked: gift is locked on-chain, unlock time not reached
    //   - unlocked: unlock time has passed but recipient has NOT yet claimed
    //
    // The smart contract allows cancel() in both the Locked and Unlocked states.
    // The backend must mirror this so that senders can reclaim funds from the
    // unclaimed-but-unlocked window (issue #78).
    //
    // Terminal statuses (claimed, cancelled, expired) cannot be cancelled.
    const cancellableStatuses = new Set(["pending_payment", "funded", "locked", "unlocked"]);
    if (!cancellableStatuses.has(gift.status)) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Gift cannot be cancelled in its current state" },
        { status: 409 }
      );
    }

    // Trigger Paystack refund (reference convention matches gift creation)
    const paystackRef = `lumigift_${gift.id}`;
    await refundPayment(paystackRef);

    const cancelled = await cancelGift(gift.id);

    return NextResponse.json<ApiResponse<Gift>>({
      success: true,
      data: cancelled,
    });
  })
);
