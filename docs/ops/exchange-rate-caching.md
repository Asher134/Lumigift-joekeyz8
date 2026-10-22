# Exchange Rate Caching Strategy

> **Related issue:** #317  
> **Source file:** `src/server/services/exchange-rate.service.ts`

---

## Overview

Lumigift converts gift amounts between NGN (Nigerian Naira) and USDC at payment time. Fetching a live exchange rate on every API request would hammer the Stellar Horizon order book and introduce unnecessary latency. A Redis caching layer sits between the application and Horizon to absorb repeated reads.

---

## Rate Fetch → Cache → Serve Flow

```
                          ┌─────────────────────────────────────┐
                          │           Application Server         │
                          │                                      │
  API Request             │   ┌──────────────────────────────┐  │
 ─────────────────────────►   │     getExchangeRate()        │  │
                          │   │                              │  │
                          │   │  1. Check Redis cache        │  │
                          │   │     key: "rate:NGN:USDC"     │  │
                          │   │                              │  │
                          │   │  Cache HIT ──────────────────┼──┼──► Return rate (source: "cache")
                          │   │                              │  │
                          │   │  Cache MISS                  │  │
                          │   │     │                        │  │
                          │   │     ▼                        │  │
                          │   │  2. Fetch from Horizon       │  │
                          │   │     /order_book endpoint     │  │
                          │   │                              │  │
                          │   │  Horizon OK ─────────────────┼──┼──► Store in Redis (TTL: 60s)
                          │   │                              │  │        └──► Return rate (source: "horizon")
                          │   │  Horizon FAIL                │  │
                          │   │     │                        │  │
                          │   │     ▼                        │  │
                          │   │  3. Check stale key          │  │
                          │   │     key: "rate:NGN:USDC:stale" │ │
                          │   │                              │  │
                          │   │  Stale found ────────────────┼──┼──► Return rate (source: "cache", stale: true)
                          │   │                              │  │
                          │   │  No stale value              │  │
                          │   │     │                        │  │
                          │   │     ▼                        │  │
                          │   │  4. Return FALLBACK_RATE     │  │
                          │   │     (1600 NGN/USDC)          │  │
                          │   └──────────────────────────────┘  │
                          └─────────────────────────────────────┘
                                          │
                          ┌───────────────▼─────────────────────┐
                          │            Redis Cache               │
                          │                                      │
                          │  "rate:NGN:USDC"      TTL: 60s      │
                          │  "rate:NGN:USDC:stale"  persists    │
                          │  "rate:locked:<giftId>" TTL: 300s   │
                          └─────────────────────────────────────┘
                                          │
                          ┌───────────────▼─────────────────────┐
                          │        Stellar Horizon               │
                          │  /order_book (NGN/USDC proxy)        │
                          └─────────────────────────────────────┘
```

---

## Configuration Constants

All constants are defined in `src/server/services/exchange-rate.service.ts`.

| Constant              | Value  | Description                                                                                   |
| --------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `CACHE_KEY`           | `rate:NGN:USDC` | Redis key for the live rate                                                        |
| `CACHE_TTL_SEC`       | `60`   | How long a freshly fetched rate stays in Redis before it is considered expired (1 minute)     |
| `FALLBACK_RATE`       | `1600` | Hardcoded NGN/USDC rate used only when Horizon is unreachable **and** no stale cache exists   |
| `LOCKED_RATE_TTL_SEC` | `300`  | How long a rate locked for a specific gift payment is valid in Redis (5 minutes)              |
| `MAX_SLIPPAGE_PERCENT`| `1`    | Maximum allowed deviation (%) between the locked rate and the current rate before a payment is rejected |

---

## Environment Variable

| Variable                  | Default | Description                                                                                   |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `EXCHANGE_RATE_CACHE_TTL` | `60`    | Override the Redis TTL (seconds) for the cached NGN/USDC rate. Set to a lower value for testing or a higher value to reduce Horizon traffic in stable environments. **Not yet wired into the service — see note below.** |

> **Note:** As of the current implementation, `CACHE_TTL_SEC` is a compile-time constant (`60`). To make it configurable without a redeploy, wire `process.env.EXCHANGE_RATE_CACHE_TTL` into the service: `const CACHE_TTL_SEC = Number(process.env.EXCHANGE_RATE_CACHE_TTL ?? 60);`. This is tracked in issue #317.

---

## Staleness Tolerance

A response from `getExchangeRate()` carries a `stale: boolean` flag:

- `stale: false` — the rate was either freshly fetched from Horizon or read from a non-expired cache entry. Safe to use for all purposes.
- `stale: true` — Horizon was unreachable; the returned value is the last known rate from a Redis stale-key or the hardcoded fallback. The `source` field will be `"cache"` (stale Redis value) or `"fallback"` (hardcoded 1600).

**Operator guidance:** If `stale: true` responses persist for more than a few minutes, Horizon may be degraded. Check the Stellar network status at [https://status.stellar.org](https://status.stellar.org). The application will keep serving requests using the fallback rate during an outage, but gift amounts will be calculated at the hardcoded rate until the cache is refreshed.

---

## Payment Rate Locking

When a gift payment is initiated, the rate is **locked** for that specific gift for 5 minutes (`LOCKED_RATE_TTL_SEC = 300`):

```
lockExchangeRate(giftId) → stores "rate:locked:<giftId>" in Redis (TTL: 300s)
validateSlippage(giftId) → compares locked rate vs current rate; rejects if deviation > 1%
```

This prevents a user from initiating a payment at one rate and having the settlement occur at a significantly different rate. If the rate changes by more than `MAX_SLIPPAGE_PERCENT` (1%) between initiation and execution, the payment is rejected with a `rate_deviated` error.

---

## Operator Runbook — Manually Refreshing Stale Rates

Use the following steps when you need to force-refresh the cached exchange rate without waiting for the TTL to expire (e.g. after a Horizon outage clears, or to unblock a degraded environment).

### Prerequisites

- Redis CLI access (`redis-cli`) or access to the Lumigift Redis instance via the cloud provider console.
- For production: use a bastion host or an authorised VPN connection to reach the Redis endpoint. See [`docs/ops/redis.md`](redis.md) for connection details.

### Steps

**1. Connect to Redis**

```bash
# Local / Docker
redis-cli -h localhost -p 6379

# Production (via AWS ElastiCache — replace endpoint)
redis-cli -h <elasticache-endpoint> -p 6379 --tls
```

**2. Inspect the current cached value**

```redis
GET rate:NGN:USDC
```

If this returns `(nil)` the cache is already expired and the next request will trigger a fresh Horizon fetch automatically.

**3. Force-delete the cached rate**

```redis
DEL rate:NGN:USDC
```

The next API call to `getExchangeRate()` will fetch a fresh rate from Horizon and repopulate the cache.

**4. Remove stale fallback (if Horizon was down and a stale key was written)**

```redis
DEL rate:NGN:USDC:stale
```

**5. Verify**

Make a test request to the exchange rate quote endpoint:

```bash
curl -s https://<app-url>/api/v1/exchange-rate/quote | jq .
```

Confirm the response shows `"source": "horizon"` and `"stale": false`.

**6. (Optional) Manually set a temporary rate**

In an emergency where Horizon is down and you need a specific rate:

```redis
SET rate:NGN:USDC 1650 EX 300
```

This sets a rate of 1650 NGN/USDC for 5 minutes. **Only use this in a confirmed emergency and document the action in the incident log.**

---

## Data Flow for a Gift Payment

```
1. User initiates gift payment
   └── lockExchangeRate(giftId) called
         └── getExchangeRate() → reads Redis or fetches Horizon
         └── stores "rate:locked:<giftId>" = <rate> (TTL: 300s)

2. User confirms payment (within 5 min window)
   └── validateSlippage(giftId) called
         └── reads "rate:locked:<giftId>" from Redis
         └── reads current rate via getExchangeRate()
         └── if |deviation| > 1% → reject with rate_deviated error
         └── if OK → proceed with payment at locked rate
```

---

## See Also

- [`docs/ops/redis.md`](redis.md) — Redis setup, connection config, and failover policy
- [`docs/ops/redis-failure-policy.md`](redis-failure-policy.md) — what happens when Redis is unavailable
- [`docs/environment-variables.md`](../environment-variables.md) — full environment variable reference
- [`src/server/services/exchange-rate.service.ts`](../../src/server/services/exchange-rate.service.ts) — source implementation
