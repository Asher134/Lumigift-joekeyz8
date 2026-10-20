# Payment Provider Webhook Setup

> Closes #113

Lumigift uses two payment providers: **Paystack** (Nigerian Naira, NGN) and
**Stripe** (international cards). Both providers send webhook events to notify
the platform of payment outcomes.

---

## Overview

| Provider | Webhook endpoint                       | Event of interest          | Signing method                            |
| -------- | -------------------------------------- | -------------------------- | ----------------------------------------- |
| Paystack | `POST /api/v1/payments/callback`       | Redirect-based (GET)       | HMAC-SHA512 on raw body                   |
| Stripe   | `POST /api/v1/payments/stripe/webhook` | `payment_intent.succeeded` | HMAC-SHA256 via `Stripe-Signature` header |

> **Note on Paystack:** Paystack uses a browser redirect (`GET` callback) rather
> than a push webhook for its primary success flow. The `POST` webhook endpoint
> for Paystack is available for server-side event push (see section below).

---

## Paystack

### How it works

After a user completes payment on Paystack's checkout page, Paystack redirects
the user's browser to:

```
GET /api/v1/payments/callback?reference=<tx_ref>&giftId=<gift_id>
```

The server calls `verifyPayment(reference)` against the Paystack API to confirm
the payment status before locking the gift.

### Paystack push webhook (server-to-server)

Paystack can also push events via HTTP POST. Configure this in the Paystack
dashboard under **Settings → API Keys & Webhooks**.

Webhook URL to register:

```
https://<your-domain>/api/v1/payments/callback
```

**Signature verification:** Paystack signs the request body with
`HMAC-SHA512` using your secret key. Verify the `x-paystack-signature` header:

```typescript
import crypto from "crypto";

function verifyPaystackSignature(rawBody: string, signature: string, secretKey: string): boolean {
  const hash = crypto.createHmac("sha512", secretKey).update(rawBody).digest("hex");
  return hash === signature;
}
```

**Required secret:**

| Environment variable  | Where to get it                          |
| --------------------- | ---------------------------------------- |
| `PAYSTACK_SECRET_KEY` | Paystack Dashboard → Settings → API Keys |

Never expose this key in client-side code or commit it to the repository. Set it
in your deployment environment and in GitHub Actions secrets.

### Paystack test events

Use the Paystack test mode secret key (`sk_test_...`) to send test events. Test
card details are available in the [Paystack test documentation](https://paystack.com/docs/payments/test-payments/).

Common test scenario:

```bash
# Trigger a successful payment in test mode
curl -X POST https://api.paystack.co/transaction/initialize \
  -H "Authorization: Bearer sk_test_YOUR_TEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "amount": 50000,
    "reference": "lumigift_test_001",
    "callback_url": "https://localhost:3000/api/v1/payments/callback?giftId=gift_test_001"
  }'
```

Replace `sk_test_YOUR_TEST_KEY` with your own Paystack test key from the
dashboard — never hardcode keys in scripts committed to the repo.

### Replay protection

The callback handler verifies the transaction with Paystack's API on every
request using the `reference` query parameter. Because Paystack's API is the
source of truth, replaying an old callback URL with the same reference will
not result in a double-fund — `updateGiftStatus` is idempotent for the
`locked` state.

---

## Stripe

### How it works

Stripe sends a `payment_intent.succeeded` event to the webhook endpoint when a
payment completes. The event payload includes a `metadata.giftId` field set
at payment creation time.

Endpoint:

```
POST /api/v1/payments/stripe/webhook
```

### Signature verification

Stripe signs every webhook payload with the `Stripe-Signature` header. The
server verifies this using the Stripe SDK's `webhooks.constructEvent`:

```typescript
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const event = stripe.webhooks.constructEvent(
  rawBody, // must be the raw, unparsed request body
  sig, // value of the `stripe-signature` header
  process.env.STRIPE_WEBHOOK_SECRET!
);
```

**Critical:** The Next.js App Router does **not** pre-parse the request body for
route handlers, so `req.text()` returns the raw bytes that Stripe requires for
signature validation. Never call `req.json()` before passing the body to
`constructEvent`.

**Required secrets:**

| Environment variable    | Where to get it                                           |
| ----------------------- | --------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | Stripe Dashboard → Developers → API keys                  |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Developers → Webhooks → signing secret |

### Configuring the webhook in Stripe Dashboard

1. Go to **Stripe Dashboard → Developers → Webhooks**.
2. Click **Add endpoint**.
3. Set the endpoint URL to:
   ```
   https://<your-domain>/api/v1/payments/stripe/webhook
   ```
4. Select the event: `payment_intent.succeeded`.
5. Copy the **Signing secret** (`whsec_...`) and set it as `STRIPE_WEBHOOK_SECRET`.

### Handled events

| Event                      | Action                                     |
| -------------------------- | ------------------------------------------ |
| `payment_intent.succeeded` | Calls `updateGiftStatus(giftId, "locked")` |

All other event types receive a `200 { received: true }` response and are
ignored. Add handlers for additional events (e.g. `payment_intent.payment_failed`)
by extending the `switch` in `src/app/api/v1/payments/stripe/webhook/route.ts`.

### Replay protection

Stripe includes a timestamp in the `Stripe-Signature` header. The SDK rejects
events with a timestamp older than 300 seconds by default, preventing replay
attacks. The `updateGiftStatus` function is also idempotent for the `locked`
state.

---

## Local Development: Forwarding Webhooks

### Stripe (recommended: Stripe CLI)

Install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and forward events
to your local server:

```bash
stripe listen --forward-to localhost:3000/api/v1/payments/stripe/webhook
```

The CLI prints a local webhook signing secret (`whsec_...`). Set this as
`STRIPE_WEBHOOK_SECRET` in your `.env.local` for local testing — it is
**different** from your production signing secret.

Trigger a test event:

```bash
stripe trigger payment_intent.succeeded
```

### Paystack (ngrok or similar)

Paystack does not provide a CLI forwarder. Use [ngrok](https://ngrok.com/) or a
similar tunnel to expose your local server:

```bash
ngrok http 3000
```

Register the ngrok HTTPS URL as the webhook URL in the Paystack test dashboard:

```
https://<ngrok-id>.ngrok.io/api/v1/payments/callback
```

Remember to update this URL each time ngrok restarts (unless you use a paid
static domain).

---

## Environment Variable Summary

| Variable                | Provider | Required in      | Description                                         |
| ----------------------- | -------- | ---------------- | --------------------------------------------------- |
| `PAYSTACK_SECRET_KEY`   | Paystack | All environments | Secret key for API calls and signature verification |
| `STRIPE_SECRET_KEY`     | Stripe   | All environments | Secret key for API calls                            |
| `STRIPE_WEBHOOK_SECRET` | Stripe   | Server-side only | Signing secret for webhook signature verification   |

All three variables must be set in:

- `.env.local` (local development)
- GitHub Actions secrets (for CI integration tests)
- Your deployment platform (Vercel, etc.)

**Never** commit these values to source control. The `.env.local` file is in
`.gitignore`. For CI, use GitHub Actions secrets referenced as
`${{ secrets.VARIABLE_NAME }}` in workflow files.
