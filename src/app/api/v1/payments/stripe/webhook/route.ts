import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { updateGiftStatus } from "@/server/services/gift.service";
import {
  startTimer,
  recordWebhookSuccess,
  recordWebhookFailure,
  recordStatusTransition,
} from "@/lib/metrics";
import type { ApiResponse } from "@/types";

// Lazily initialised so module evaluation at build time never throws.
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
      apiVersion: "2026-04-22.dahlia",
    });
  }
  return _stripe;
}

// Next.js must not parse the body — Stripe needs the raw bytes for signature verification.
// In App Router, request body is not pre-parsed, so no config needed.

const IDEMPOTENCY_TTL_SECONDS = 86_400; // 24 hours

export async function POST(req: NextRequest) {
  const elapsed = startTimer();

  // Guard moved inside handler so missing env var is a 500 at request time,
  // not a module-level crash that breaks the build.
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    recordWebhookFailure("stripe", "unknown", elapsed(), "missing_webhook_secret");
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Stripe webhook secret not configured" },
      { status: 500 }
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    recordWebhookFailure("stripe", "unknown", elapsed(), "missing_signature_header");
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Missing Stripe-Signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    recordWebhookFailure("stripe", "unknown", elapsed(), "signature_verification_failed", err);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: `Webhook signature verification failed: ${message}` },
      { status: 400 }
    );
  }

  const eventType = event.type;

  try {
    if (eventType === "payment_intent.succeeded") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const giftId = intent.metadata?.giftId;
      if (giftId) {
        await updateGiftStatus(giftId, "locked");
        recordStatusTransition(giftId, "pending_payment", "locked", "webhook:stripe");
      }
    }

    recordWebhookSuccess("stripe", eventType, elapsed(), "processed");
    return NextResponse.json<ApiResponse<{ received: boolean }>>({
      success: true,
      data: { received: true },
    });
  } catch (err) {
    recordWebhookFailure("stripe", eventType, elapsed(), "processing_error", err);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Internal error processing webhook" },
      { status: 500 }
    );
  }
}
