# Issue #278: Multiple payment providers per gift

This is an investigation PR, not an implementation. The current data model stores payment attempts in `payment_references`, but the service flow does not yet treat that table as the source of truth for multiple attempts.

## Findings

- `createGift` records one Paystack reference and starts Paystack directly, regardless of the selected provider in the request.
- `transitionGiftStatus` updates every payment reference for a gift instead of identifying the provider attempt that caused the transition.
- Reconciliation polls Paystack using a synthesized `lumigift_<gift-id>` reference; it does not enumerate stored references or dispatch by provider.
- The existing migration calls the terminal success state `success`, while the issue acceptance criteria call it `paid`.
- “Split between two senders” requires aggregating multiple successful contributions, but “only one reference may be in paid state per gift” disallows that state. Those rules need a product decision before schema constraints or webhook behavior can be safely implemented.

## Decisions needed

1. Does a gift represent one full payment with provider failover, or an aggregate of partial contributions?
2. Which status vocabulary is canonical, and what payment amount/state makes the gift eligible for escrow funding?
3. How should existing provider references and gifts be backfilled, including failed or duplicate attempts?

Once these are settled, implementation should make payment-reference lookups authoritative, update one reference per webhook/reconciliation event, enforce the agreed paid-state invariant in PostgreSQL, and test concurrent provider callbacks and legacy-data migration.
