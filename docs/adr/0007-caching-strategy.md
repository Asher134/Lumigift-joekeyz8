# ADR-0007: Caching Strategy

**Date:** 2026-10-21  
**Status:** Proposed  
**Issue:** [#361 — Add Architecture Decision Record for caching strategy](https://github.com/joekeyz8/Lumigift-lumigift/issues/361)

## Context

Lumigift uses several caching layers — Redis for OTPs, exchange rates and rate limits, the Next.js data cache for API responses, and the Vercel CDN edge cache for static assets. Each layer was introduced independently and the TTL and invalidation choices were never recorded in one place.

## Decision

Use each layer only for data whose freshness and consistency requirements it fits:

| Layer             | What is cached                                 | TTL                             | Invalidation                                        |
| ----------------- | ---------------------------------------------- | ------------------------------- | --------------------------------------------------- |
| Redis             | OTP codes                                      | 10 minutes                      | Deleted on successful verification; expires on TTL  |
| Redis             | Rate-limit counters (per phone / per IP)       | Window length (10 min / 1 hour) | Expire on TTL (`INCR` + `EXPIRE`)                   |
| Redis             | NGN/USDC exchange rates                        | 60 seconds                      | Expire on TTL; refreshed on next read               |
| Redis             | Distributed locks (e.g. gift unlock)           | 30 seconds                      | Released by owner token; TTL guards crashed workers |
| Next.js cache     | Read-only API responses (public, non-personal) | `revalidate` per route (≤ 60 s) | Time-based revalidation; `revalidateTag` on writes  |
| CDN edge (Vercel) | Static assets, images, public pages            | Immutable hashed assets: 1 year | New deploy changes asset hashes                     |

Rules:

- **Never cache personal or authenticated responses** at the Next.js or CDN layer; use `Cache-Control: private, no-store` for them.
- **Redis is the only shared cache** across serverless instances; the Next.js cache is per-deployment and the CDN is per-region.
- **Security-sensitive state** (OTPs, rate limits, locks) lives only in Redis and fails closed when Redis is unavailable.
- Gift, payment and balance data is always read from PostgreSQL or Stellar — never from a cache.

## Cache-stampede mitigations

- **Short TTLs with jitter** on exchange rates so keys across instances do not expire simultaneously.
- **Stale-while-revalidate** on Next.js-cached routes so one request refreshes while others are served the previous value.
- **Single-flight locking** (`SET NX PX`) around expensive recomputation, so only one worker refreshes a key.
- **Immutable, content-hashed assets** at the CDN so deploys never cause a mass origin miss for existing files.

## Alternatives considered

| Option                       | Trade-offs                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| In-memory per-instance cache | Zero latency but inconsistent across serverless instances; unsafe for OTPs and rate limits.    |
| Redis for everything         | Consistent, but adds latency and cost for static and public content better served at the edge. |
| CDN caching of API responses | Highest offload, but risks leaking personal data and makes invalidation coarse.                |

## Consequences

- Redis availability is on the critical path for authentication; outages return a safe 503.
- Public data may be up to one TTL stale; this is acceptable for exchange rates and listings.
- New cached data must be added to the table above with its TTL and invalidation strategy.
