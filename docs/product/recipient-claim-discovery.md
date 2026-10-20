# Recipient claim discovery

Issue: #148 · Page: `/claim` · API: `POST /api/v1/gifts/discover`

## Goal

A recipient who lost their SMS link, or never received it, can find the gifts waiting for their number. The flow must not reveal to anyone else whether a given number has a gift.

## Flow

1. The recipient enters their phone number on `/claim`. The page calls `POST /api/v1/auth/send-otp`. That endpoint returns the same message for every number, and is limited to 3 sends per phone per 10 minutes and 10 per IP per hour.
2. The recipient enters the code. The page calls `POST /api/v1/gifts/discover` with `{ phone, otp }`.
3. After a successful verification, the API returns `{ gifts: [...] }`. The list is empty when there are none.

## Anti-enumeration guarantees

- **Verification first.** Gifts are looked up only after the OTP verifies.
- **One error for every failure.** These cases all return the identical body, `401 VERIFICATION_FAILED`:
  - a wrong code
  - an expired code
  - a code that was never issued
  - lockout after 5 attempts
  - a malformed phone number
  - a malformed code

  So a caller cannot tell an unknown number from a wrong one. The regression test is `PT-06` in `src/server/__tests__/security-regressions.test.ts`.

- **Same shape for "no gifts".** A verified number with no gifts gets the same `200` shape, just with an empty list.
- **What is never shown:** unpaid, cancelled or expired gifts.
- **Minimal projection.** Each listed gift contains only its ID, recipient name, status and unlock date. The amount is included only once the gift is unlocked. The sender ID, message and phone hash are never included.
- **Rate limits.** 10 discovery attempts per IP per 10 minutes, on top of the OTP attempt lockout.

The claim endpoint follows the same principle. An unknown gift ID, a gift addressed to another phone, and a session with no phone all return the same `404 Gift not found` (see PT-01).
