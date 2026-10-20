/**
 * GET /api/v1/gifts/[id]/events — Server-Sent Events stream (issue #272)
 *
 * Streams real-time gift status changes to the connected client using the
 * SSE protocol (text/event-stream).
 *
 * ## Auth
 * Requires a valid session cookie.  Returns 401 if unauthenticated.
 * Returns 403 if the authenticated user is neither the sender nor recipient.
 *
 * ## Events emitted
 * - `connected`  — Sent immediately on connection, includes the current status.
 * - `status`     — Emitted when the gift's status changes (Redis pub/sub).
 * - `heartbeat`  — Sent every 30 s to keep the connection alive through proxies.
 *
 * ## Client reconnection
 * The `retry:` field instructs the browser's EventSource to reconnect after
 * 5 seconds if the connection drops — the client reconnects automatically.
 *
 * ## Cleanup
 * The Redis subscriber connection is closed when the client disconnects so
 * no connections leak, even under high concurrency.
 */

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGiftById, hashPhone } from "@/server/services/gift.service";
import { createSubscriberClient, giftStatusChannel } from "@/lib/redis";

/** How often to send a heartbeat to keep the connection alive (ms). */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Tell the browser to reconnect after 5 s if the stream drops. */
const SSE_RETRY_MS = 5_000;

/** Helper — formats a Server-Sent Event message. */
function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest, context: { params: { id: string } }) {
  const { id: giftId } = context.params;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── Gift lookup ───────────────────────────────────────────────────────────
  const gift = await getGiftById(giftId);
  if (!gift) {
    return new Response("Gift not found", { status: 404 });
  }

  // ── Ownership check ───────────────────────────────────────────────────────
  const userId = (session.user as { id?: string }).id;
  const phone = (session.user as { phone?: string }).phone;
  const recipientPhoneHash = phone ? hashPhone(phone) : undefined;

  const isSender = !!userId && gift.senderId === userId;
  const isRecipient = !!recipientPhoneHash && gift.recipientPhoneHash === recipientPhoneHash;

  if (!isSender && !isRecipient) {
    return new Response("Forbidden", { status: 403 });
  }

  // ── Set up ReadableStream + Redis subscriber ───────────────────────────────
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Encode and enqueue an SSE message
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(new TextEncoder().encode(sseMessage(event, data)));
        } catch {
          // Controller may already be closed if the client disconnected
        }
      };

      // Tell the browser how long to wait before reconnecting
      controller.enqueue(new TextEncoder().encode(`retry: ${SSE_RETRY_MS}\n\n`));

      // Send the current status immediately so the client is in sync
      send("connected", {
        giftId: gift.id,
        status: gift.status,
        updatedAt: gift.updatedAt,
      });

      // ── Subscribe to Redis channel ─────────────────────────────────────
      let subscriber: Awaited<ReturnType<typeof createSubscriberClient>> | null = null;

      try {
        subscriber = await createSubscriberClient();

        await subscriber.subscribe(giftStatusChannel(giftId), (message) => {
          try {
            const payload = JSON.parse(message) as {
              giftId: string;
              previousStatus: string;
              status: string;
              updatedAt: string;
            };
            send("status", payload);
          } catch {
            // Malformed message — skip
          }
        });
      } catch (err) {
        // If Redis is unavailable, the stream still works — clients just won't
        // receive push events (they can fall back to polling).
        console.error("[SSE] Redis subscribe failed:", err);
      }

      // ── Heartbeat ─────────────────────────────────────────────────────
      heartbeatTimer = setInterval(() => {
        send("heartbeat", { ts: new Date().toISOString() });
      }, HEARTBEAT_INTERVAL_MS);

      // ── Cleanup on client disconnect ──────────────────────────────────
      req.signal.addEventListener("abort", async () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          if (subscriber) {
            await subscriber.unsubscribe(giftStatusChannel(giftId));
            await subscriber.quit();
          }
        } catch {
          // Best-effort cleanup — ignore errors during teardown
        }
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Allow the X-Request-Id header set by the edge middleware through
      "X-Accel-Buffering": "no",
    },
  });
}
