/**
 * Next.js Edge Middleware — Request Correlation IDs (#268)
 *
 * For every incoming request this middleware:
 *  1. Reads the inbound `x-correlation-id` header (set by upstream load
 *     balancers / clients) or generates a fresh UUID v4.
 *  2. Forwards the ID to the downstream route handler via the
 *     `x-correlation-id` request header so route-level loggers can bind it.
 *  3. Reflects the same ID back to the caller on both `X-Request-Id` and
 *     `x-correlation-id` response headers so every HTTP response is
 *     uniquely traceable.
 *
 * The edge middleware runs before any route handler, so ALL responses —
 * pages, API routes, static files — carry the header automatically.
 * Route handlers that use `withErrorHandler` additionally embed the
 * `requestId` in structured logs and error response bodies.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

export function middleware(req: NextRequest) {
  // Honour an upstream correlation ID (e.g. from a load balancer), or mint a
  // fresh UUID v4 for this request.
  const requestId = req.headers.get("x-correlation-id") || randomUUID();

  // Clone the request headers so we can inject the correlation ID before the
  // route handler sees the request.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-correlation-id", requestId);

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Reflect the ID on both header names for maximum interoperability.
  res.headers.set("X-Request-Id", requestId);
  res.headers.set("x-correlation-id", requestId);

  return res;
}

export const config = {
  /**
   * Run on all routes except Next.js internals and static assets.
   * This ensures every API response AND every page response carries the
   * X-Request-Id header.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
