import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { serverConfig } from "@/server/config";
import { updateGiftStatus } from "@/server/services/gift.service";
import { getRedisClient } from "@/lib/redis";
import {
  startTimer,
  recordWebhookSuccess,
  recordWebhookFailure,
  recordStatusTransition,
} from "@/lib/metrics";

const IDEMPOTENCY_TTL_SECONDS = 86_400; // 24 hours

function verifySignature(rawBody: string, signature: string): boolean {
  const expected = crypto
    .createHmac("sha512", serverConfig.paystack.secretKey)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.padEnd(a.length, "\0").slice(0, a.length));
  return a.length === Buffer.from(signature).length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const elapsed = startTimer();
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";

  if (!verifySignature(rawBody, signature)) {
    recordWebhookFailure("paystack", "unknown", elapsed(), "invalid_signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: {
    event: string;
    data: { reference: string; status: string; metadata?: { giftId?: string } };
  };
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    recordWebhookFailure("paystack", "unknown", elapsed(), "invalid_json", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = event.event ?? "unknown";
  const { reference } = event.data;
  const redis = await getRedisClient();
  const idempotencyKey = `paystack:ref:${reference}`;

  // Return 200 immediately for already-processed references (idempotency)
  const alreadyProcessed = await redis.get(idempotencyKey);
  if (alreadyProcessed) {
    recordWebhookSuccess("paystack", eventType, elapsed(), "duplicate_ignored");
    return NextResponse.json({ received: true });
  }

  try {
    if (eventType === "charge.success") {
      const giftId = event.data.metadata?.giftId;
      if (giftId) {
        await updateGiftStatus(giftId, "locked");
        recordStatusTransition(giftId, "pending_payment", "locked", "webhook:paystack");
      }
    }

    // Mark reference as processed with 24-hour TTL
    await redis.set(idempotencyKey, "1", { EX: IDEMPOTENCY_TTL_SECONDS });

    recordWebhookSuccess("paystack", eventType, elapsed(), "processed");
    return NextResponse.json({ received: true });
  } catch (err) {
    recordWebhookFailure("paystack", eventType, elapsed(), "processing_error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
