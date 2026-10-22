# ADR-0006: SMS Provider — Termii

**Date:** 2026-10-20  
**Status:** Proposed  
**Issue:** [#309 — Create an ADR for the SMS provider choice](https://github.com/joekeyz8/Lumigift-lumigift/issues/309)

## Context

Lumigift uses SMS to deliver phone-verification OTPs, gift invitations, and new-device login alerts. The application currently sends these messages through Termii's `https://api.ng.termii.com/api` endpoint using its `/sms/send` API. SMS delivery is part of account access and the gift-claim flow, so delivery coverage, cost, and provider availability matter.

The product primarily serves users in Nigeria. The provider must support Nigerian destinations and sender IDs, offer a practical cost for transactional messages, and expose an API that the application can call and monitor reliably. Provider pricing, routes, and delivery performance can change; these should be rechecked before a provider migration or pricing commitment.

## Decision

Continue using **Termii** as the SMS provider for Nigerian transactional messages. Keep provider calls behind the server-side SMS module so delivery behavior and credentials are not coupled to route handlers.

This is a proposed decision for maintainer review. It is based on the current integration and product requirements; it does not assert that Termii is always the cheapest or most reliable provider for every route.

## Decision criteria

| Criterion                  | Importance | Rationale                                                                                                                                                                                     |
| -------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nigerian market coverage   | High       | OTPs and gift invitations must reach the primary user base, with workable local sender-ID and route support.                                                                                  |
| Pricing                    | High       | Transactional SMS is sent per message; current rates, route fees, and volume terms should be compared for Nigerian destinations rather than assumed from global list prices.                  |
| API reliability            | High       | A clear, authenticated API and useful delivery reporting help diagnose delayed or failed OTP and invitation messages. Actual delivery depends on the provider and downstream mobile networks. |
| Integration and operations | Medium     | A server-side API integration should fit the existing TypeScript service and support secure credential management and failure handling.                                                       |

## Alternatives considered

| Provider              | Advantages                                                                                                       | Trade-offs                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Twilio**            | Mature messaging APIs, extensive documentation, and broad international reach.                                   | Nigerian route availability, sender-ID support, and per-message pricing should be confirmed for the intended traffic; global coverage alone does not establish the best local delivery or cost. |
| **Africa's Talking**  | Africa-focused messaging services and a regional API option.                                                     | Nigerian route coverage, sender-ID onboarding, current pricing, and delivery reporting should be validated against production requirements before migration.                                    |
| **Vonage**            | Established communications APIs and international messaging coverage.                                            | Nigerian destination routes, sender-ID constraints, and current rates need verification; international scale does not by itself guarantee local cost or delivery performance.                   |
| **Termii (selected)** | Existing integration targets its Nigeria API and is already used by OTP, invitation, and new-device alert flows. | Adds a third-party dependency; actual delivery depends on configured routes and mobile networks, and current rates and reliability need ongoing review.                                         |

No provider is assumed to have fixed prices or guaranteed delivery. Before changing providers, compare current Nigerian destination rates, local sender-ID requirements, delivery receipts, support response, and measured delivery outcomes using representative traffic.

## Consequences

### Positive

- The current SMS flows remain on an already-integrated provider rather than requiring a migration.
- A single server-side integration keeps provider credentials and API calls out of client code.
- The criteria above give future provider reviews a consistent basis for comparison.

### Negative / risks

- A Termii outage or route issue can delay OTPs and gift notifications.
- Provider and downstream carrier delivery cannot be guaranteed by the application.
- Prices, sender-ID rules, and country-route availability may change and require periodic verification.

### Mitigations

- Keep SMS delivery isolated in `src/lib/sms.ts` and handle delivery failures at call sites.
- Monitor delivery failures and review current Nigerian pricing and delivery performance before committing to volume or changing providers.
- Keep OTP rate limits and expiry independent of the SMS provider.

## References

- Current integration: `src/lib/sms.ts`
- Termii API base URL currently used by the application: `https://api.ng.termii.com/api`
- [Twilio Messaging](https://www.twilio.com/docs/messaging)
- [Africa's Talking SMS](https://developers.africastalking.com/docs/sms/overview)
- [Vonage Messages API](https://developer.vonage.com/en/messages/overview)
