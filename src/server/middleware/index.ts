import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import * as Sentry from "@sentry/nextjs";
import { authOptions } from "@/lib/auth";
import { ApiError } from "@/types";
import { requestLogger, getCorrelationId } from "@/lib/logger";
import { mapError } from "@/server/errors";

// Re-export error primitives so route handlers can import from one place
export { AppError } from "@/server/errors";
export { ERROR_CODES } from "@/server/errors";

// Re-export CSRF middleware so callers can import from one place
export { withCsrf } from "@/lib/csrf";

// Re-export validation helper so callers can import from one place
export { validateBody } from "./validate";
export type { ValidationResult, ValidationSuccess, ValidationFailure } from "./validate";

type Handler = (_req: NextRequest, _context?: unknown) => Promise<NextResponse>;

/** Wraps a route handler — returns 401 if no session. */
export function withAuth(handler: Handler): Handler {
  return async (req, _context) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiError>(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    return handler(req, _context);
  };
}

const API_VERSION = "v1";

/**
 * Attaches correlation/request-ID response headers to an outgoing response.
 *
 * Headers set on **every** response (success and error):
 *  - `X-Request-Id`      — UUID v4 generated for this request (matches the
 *                          `requestId` field in error bodies).
 *  - `x-correlation-id`  — Same ID echoed back so callers that send the header
 *                          receive it back unchanged.
 *  - `X-API-Version`     — Stable API version string.
 */
function attachRequestHeaders(res: NextResponse, requestId: string): void {
  res.headers.set("X-Request-Id", requestId);
  res.headers.set("x-correlation-id", requestId);
  res.headers.set("X-API-Version", API_VERSION);
}

/**
 * Wraps a route handler with error handling that:
 *  1. Generates a UUID v4 `requestId` for every request (honours an inbound
 *     `x-correlation-id` header so distributed traces are preserved).
 *  2. Attaches `X-Request-Id`, `x-correlation-id`, and `X-API-Version` to
 *     **every** response — success and error alike.
 *  3. Maps thrown errors to stable public codes via {@link mapError}.
 *  4. Logs the full internal error (including stack trace) to Pino + Sentry,
 *     tagged with the `requestId` so every log line is traceable.
 *  5. Returns a sanitised response body — no stack traces or provider secrets
 *     ever reach the client.
 *  6. Includes `requestId` in error response bodies so clients can report
 *     issues by quoting a single identifier.
 */
export function withErrorHandler(handler: Handler): Handler {
  return async (req, context) => {
    // Honour an inbound correlation ID from upstream services; otherwise mint a
    // fresh UUID v4 so every request has a unique, traceable identifier.
    const requestId = getCorrelationId(req.headers) || randomUUID();
    const log = requestLogger(requestId);

    try {
      const res = await handler(req, context);
      attachRequestHeaders(res, requestId);
      return res;
    } catch (err) {
      const mapped = mapError(err);

      // Log full internal error server-side — stack + cause never leave the server
      if (mapped.code === "INTERNAL_ERROR") {
        log.error({ err, requestId, path: req.nextUrl.pathname }, "[API] Unhandled error");
        // Report unexpected errors to Sentry with requestId for tracing
        Sentry.withScope((scope) => {
          scope.setTag("requestId", requestId);
          scope.setTag("correlationId", requestId);
          scope.setTag("path", req.nextUrl.pathname);
          scope.setExtra("url", req.url);
          Sentry.captureException(err);
        });
      } else {
        // Known/expected error — log at warn level with requestId
        log.warn(
          { code: mapped.code, status: mapped.status, requestId, err },
          "[API] Application error"
        );
      }

      const res = NextResponse.json<ApiError>(
        {
          success: false,
          error: mapped.publicMessage,
          code: mapped.code,
          // requestId in the body lets clients report issues by quoting one ID
          requestId,
        } as ApiError & { requestId: string },
        { status: mapped.status }
      );
      attachRequestHeaders(res, requestId);
      return res;
    }
  };
}

/** Rate-limit helper (simple in-memory; swap for Redis in production). */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) return false;

  entry.count++;
  return true;
}

/**
 * Rejects requests whose `Content-Length` header exceeds `maxBytes`.
 *
 * This is a defence-in-depth check that runs *before* the body is read,
 * so oversized payloads are rejected cheaply without buffering them.
 * The limit is also enforced by Next.js server-action config, but route
 * handlers benefit from this explicit guard.
 *
 * @param maxBytes - Maximum allowed body size in bytes.
 * @returns A wrapper that returns 413 when the declared body is too large.
 *
 * @example
 * // Limit a route to 64 KB of JSON
 * export const POST = withErrorHandler(
 *   withBodySizeLimit(64 * 1024)(withCsrf(handler))
 * );
 */
export function withBodySizeLimit(maxBytes: number) {
  return function (handler: Handler): Handler {
    return async (req, context) => {
      const contentLength = req.headers.get("content-length");
      if (contentLength !== null) {
        const bytes = parseInt(contentLength, 10);
        if (!isNaN(bytes) && bytes > maxBytes) {
          return NextResponse.json<ApiError>(
            {
              success: false,
              error: `Request body too large. Maximum allowed size is ${maxBytes} bytes.`,
              code: "PAYLOAD_TOO_LARGE",
            },
            { status: 413 }
          );
        }
      }
      return handler(req, context);
    };
  };
}
