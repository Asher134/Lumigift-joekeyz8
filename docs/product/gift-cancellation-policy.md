# Gift cancellation policy

Issue: #147 · Code: `src/server/services/cancellation.service.ts`

## Eligibility mirrors the escrow contract

The Soroban contract's `cancel()` (`contracts/escrow/src/lib.rs`) has two rules:

- only the sender can call it;
- it fails once the escrow is **claimed** or **already cancelled**.

It has **no unlock-time check**. The API applies the same rules:

| Gift status                | Can cancel?                                                  | Refund                       |
| -------------------------- | ------------------------------------------------------------ | ---------------------------- |
| `draft`, `pending_payment` | Yes                                                          | None needed (`not_required`) |
| `funded`, `locked`         | Yes                                                          | Paystack refund              |
| `unlocked`                 | Yes, with a warning that the recipient may be about to claim | Paystack refund              |
| `claimed`                  | No                                                           | —                            |
| `cancelled`                | No                                                           | —                            |
| `expired`                  | No, the expiry cron refunds it automatically                 | —                            |

Only the sender can cancel. Anyone else gets `404` (never `403`), so they cannot tell whether the gift exists.

## Flow

1. The sender clicks **Cancel gift** on their dashboard card.
2. The UI calls `GET /api/v1/gifts/:id/cancel`. The response contains:
   - `eligible` and `reason`
   - `refundRequired`
   - a list of `consequences`
   - a `supportUrl`
3. A confirmation dialog shows those consequences:
   - the recipient loses access;
   - the cancellation is permanent;
   - the refund timeline;
   - processing fees are not refunded;
   - for unlocked gifts, a warning that the recipient may be about to claim.
4. On confirm, the UI calls `DELETE /api/v1/gifts/:id`.
5. For paid gifts, the Paystack refund is requested **before** the status changes. If Paystack rejects the request, the call returns `502 REFUND_FAILED` and the gift stays active, so the sender can retry or contact support. A gift is never cancelled with no refund in flight.
6. The gift moves to `cancelled` through the state machine and gets a `gift_cancelled` audit entry. `refundStatus` and `cancelledAt` are recorded on the gift.

## Refund status and support path

The gift card shows the refund status and a link to the help-centre section at `/help#cancellation-policy`:

| `refundStatus` | Copy                                                                              |
| -------------- | --------------------------------------------------------------------------------- |
| `not_required` | No refund needed — no payment was taken.                                          |
| `pending`      | Refund in progress, usually 3–5 business days. Link: _Get help with a refund_     |
| `processed`    | Refund completed to your original payment method.                                 |
| `failed`       | Refund needs attention. Support has been notified. Link: _Get help with a refund_ |

## Follow-ups (not in this change)

- Update `refundStatus` from `pending` to `processed`/`failed` using Paystack `refund.*` webhooks.
- Call the on-chain `cancel()` for gifts that have a `contractId`. The contract requires the sender's signature, so this needs the wallet-signing flow.
