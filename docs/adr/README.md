# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for Lumigift. ADRs document significant technical choices, the context that drove them, and the trade-offs accepted.

## What is an ADR?

An ADR is a short document that captures a single architectural decision. It answers:

- **Why** was this decision made?
- **What** was decided?
- **What** are the consequences?
- **What** alternatives were considered?

## Creating a new ADR

1. Copy `template.md` to a new file: `NNNN-short-title.md` (zero-padded 4-digit number).
2. Fill in all sections.
3. Set the status to `Proposed` and open a PR for review.
4. Once merged, update the status to `Accepted`.
5. Add a row to the index table below.

## Index

| ADR                                                | Title                                      | Status   | Date       |
| -------------------------------------------------- | ------------------------------------------ | -------- | ---------- |
| [ADR-0001](0001-blockchain-stellar-soroban.md)     | Blockchain Platform — Stellar / Soroban    | Accepted | 2024-01-15 |
| [ADR-0002](0002-payment-provider-paystack.md)      | Payment Provider — Paystack (NGN On-Ramp)  | Accepted | 2024-01-15 |
| [ADR-0003](0003-auth-phone-otp.md)                 | Authentication Method — Phone OTP          | Accepted | 2024-01-15 |
| [ADR-0004](0004-database-postgresql.md)            | Database — PostgreSQL                      | Accepted | 2024-01-15 |
| [ADR-0005](0005-escrow-admin-upgrade-authority.md) | Escrow Admin Storage and Upgrade Authority | Accepted | 2026-09-28 |
| [ADR-0006](0006-sms-termii.md)                     | SMS Provider — Termii                      | Proposed | 2026-10-20 |
| [ADR-0007](0007-caching-strategy.md)               | Caching Strategy                           | Proposed | 2026-10-21 |
