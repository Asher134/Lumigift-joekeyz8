# Privacy & Data Retention

> Closes #115

This document describes how Lumigift collects, stores, processes, and retains
personal data. It covers every data category handled by the platform, identifies
the processors involved, and documents retention periods and deletion procedures.

The implementation described here matches the live codebase as of the date of
this document. Any change to data flows must be reflected here as part of the
same PR.

---

## Table of Contents

1. [Data categories and processors](#1-data-categories-and-processors)
2. [Phone number hashing](#2-phone-number-hashing)
3. [Audit logs](#3-audit-logs)
4. [Media uploads](#4-media-uploads)
5. [Payment metadata](#5-payment-metadata)
6. [Gift invitations](#6-gift-invitations)
7. [Notification preferences](#7-notification-preferences)
8. [Blockchain data](#8-blockchain-data)
9. [Retention periods](#9-retention-periods)
10. [Deletion and erasure](#10-deletion-and-erasure)
11. [Data flow diagram](#11-data-flow-diagram)

---

## 1. Data categories and processors

| Data category              | Storage location                           | Processor(s)                     | Contains PII?               |
| -------------------------- | ------------------------------------------ | -------------------------------- | --------------------------- |
| Phone numbers (sender)     | PostgreSQL `users` table                   | Lumigift (self-hosted / Vercel)  | Yes                         |
| Phone numbers (recipient)  | SHA-256 hash only in PostgreSQL            | Lumigift                         | No (hash only)              |
| OTP codes                  | Redis (TTL 5 min)                          | Lumigift, Upstash/Redis provider | No                          |
| Gift records               | PostgreSQL `gifts` table                   | Lumigift                         | Indirect (via user_id)      |
| Audit logs                 | PostgreSQL `audit_logs` table              | Lumigift                         | Indirect (IP, user_id)      |
| Media (images/video)       | Cloudinary (CDN)                           | Cloudinary                       | Potentially (user-uploaded) |
| Payment references         | PostgreSQL `gifts` table                   | Lumigift                         | No (references only)        |
| Payment events             | Paystack / Stripe servers                  | Paystack, Stripe                 | Yes (card data, email)      |
| Stellar transaction hashes | PostgreSQL `gifts` table                   | Lumigift, Stellar network        | No                          |
| Notification preferences   | PostgreSQL `user_notification_preferences` | Lumigift                         | No                          |
| Session tokens             | HTTP-only cookies, Redis                   | Lumigift                         | Yes (session identity)      |
| Device fingerprints        | PostgreSQL `device_tracking` table         | Lumigift                         | Yes                         |

---

## 2. Phone number hashing

### Policy

Lumigift does **not** store recipient phone numbers in plaintext. This is a
deliberate privacy control introduced in migration `0003_hash_recipient_phone.sql`.

### Implementation

When a gift is created:

1. The recipient's phone number is normalised to E.164 format
   (e.g. `+2348012345678`) by the `normalizePhone` function in `src/lib/phone.ts`.
2. The normalised number is hashed with **SHA-256** using PostgreSQL's `pgcrypto`
   extension: `encode(digest(recipient_phone, 'sha256'), 'hex')`.
3. The hash is stored in `gifts.recipient_phone_hash`.
4. The plaintext number is used **transiently** — only to dispatch the SMS
   delivery notification via Termii — and is never written to the database.

### Lookup

Recipient lookups (e.g. "find gifts for this phone number") are performed by
hashing the candidate number and querying `gifts_recipient_phone_hash_idx`.

### Consequence

Because only the hash is stored, Lumigift **cannot reconstruct a recipient's
phone number** from its database. If a recipient's number changes, a new gift
must be created with the updated number.

### Sender phone numbers

Sender phone numbers are stored in the `users` table. They are used for:

- OTP authentication (`/api/v1/auth/send-otp`)
- SMS notifications about gift status changes

These are retained as long as the user account exists.

---

## 3. Audit logs

### Policy

All financial operations produce an append-only audit log entry. Logs are
retained for a **minimum of 7 years** for AML compliance.

### Implementation

Schema: `migrations/0005_audit_logs.sql`

```sql
CREATE TABLE audit_logs (
  id           UUID        PRIMARY KEY,
  event_type   TEXT        NOT NULL,  -- gift_created, payment_received, gift_funded, gift_claimed, gift_cancelled
  user_id      TEXT,
  gift_id      TEXT,
  amount_ngn   INTEGER,
  amount_usdc  TEXT,
  timestamp    TIMESTAMPTZ NOT NULL,
  ip_address   INET,
  user_agent   TEXT,
  metadata     JSONB,                 -- payment provider, tx hashes, error details
  created_at   TIMESTAMPTZ NOT NULL
);
```

Database-level `NO UPDATE` and `NO DELETE` rules are enforced by PostgreSQL
rules, making the table append-only even for database administrators.

### Data in audit logs

| Field        | Contains PII?     | Notes                                                   |
| ------------ | ----------------- | ------------------------------------------------------- |
| `user_id`    | Indirect          | References `users.id` (not a name or phone number)      |
| `ip_address` | Yes               | INET type; treated as PII under GDPR/NDPR               |
| `user_agent` | Yes (potentially) | Browser/device fingerprint                              |
| `metadata`   | Varies            | Payment references, Stellar tx hashes — no card numbers |

Card numbers and full payment details are **never** written to audit logs.
The metadata field contains only references and outcome codes.

### Processor

Lumigift's own PostgreSQL instance (self-hosted or managed, depending on
environment). Audit logs do not leave the database.

---

## 4. Media uploads

### Policy

Users may attach an image or short video to a gift. Media is stored on
**Cloudinary** (third-party CDN).

### Implementation

- Upload signing is handled server-side by `/api/v1/uploads/sign` using the
  `CLOUDINARY_API_SECRET` environment variable. Clients receive a signed upload
  URL and post directly to Cloudinary.
- The returned `public_id` and `secure_url` are stored in the `gifts` table.
- No media is stored on Lumigift's servers.

### PII considerations

User-uploaded media may contain faces or other personal information. This is
disclosed in the Terms of Service. Cloudinary processes media under its own
privacy policy. Lumigift does not perform facial recognition or automated
analysis of uploaded media.

### Deletion

When a gift is deleted, the platform should call the Cloudinary Destroy API
to remove the associated media asset. This is not yet automated — see the
deletion procedure in §10.

---

## 5. Payment metadata

### What is stored

| Field                | Table   | Value type                                            |
| -------------------- | ------- | ----------------------------------------------------- |
| `paystack_reference` | `gifts` | Transaction reference string (e.g. `lumigift_<uuid>`) |
| `stellar_tx_hash`    | `gifts` | Stellar transaction hash (public blockchain data)     |
| `amount_ngn`         | `gifts` | Integer kobo amount                                   |
| `amount_usdc`        | `gifts` | USDC string amount                                    |

### What is NOT stored

- Card numbers, CVVs, bank account numbers
- Paystack authorization codes (used only transiently during checkout)
- Stripe customer IDs (no subscription model)
- Full payment intent objects

Payment card data is processed exclusively by **Paystack** and **Stripe** under
their respective PCI-DSS certifications. Lumigift never receives or stores raw
card data.

### Processors

| Provider | Data they hold                              | DPA link                                                       |
| -------- | ------------------------------------------- | -------------------------------------------------------------- |
| Paystack | Transaction records, card data, payer email | [Paystack Privacy Policy](https://paystack.com/privacy-policy) |
| Stripe   | Payment intents, card data, payer details   | [Stripe Privacy Policy](https://stripe.com/privacy)            |

---

## 6. Gift invitations

### Policy

When a gift is sent to an unregistered recipient, an invitation record is
created with a time-limited token. These records contain a copy of the recipient
phone number **in plaintext** for the purpose of sending SMS invitations.

### Implementation

Schema: `migrations/0004_gift_invitations.sql`

```sql
CREATE TABLE gift_invitations (
  token                 TEXT    UNIQUE NOT NULL,  -- invitation link token
  recipient_phone_hash  TEXT    NOT NULL,         -- SHA-256 hash
  recipient_phone       TEXT    NOT NULL,         -- plaintext (see below)
  expires_at            TIMESTAMPTZ NOT NULL,     -- 30 days from creation
  status                TEXT    NOT NULL          -- pending, accepted, expired, claimed
);
```

### Why plaintext is stored here

The invitation record requires the plaintext number to resend SMS reminders
during the invitation window. This is the **only** table where recipient phone
numbers appear in plaintext.

### Retention

Invitation records expire after 30 days (`expires_at`). Expired records with
status `expired` or `claimed` should be purged from the database as part of
routine data hygiene (see §10). The `recipient_phone` field in expired rows
must be nulled or the row deleted before the retention window ends.

---

## 7. Notification preferences

### Policy

User notification preferences are stored in
`user_notification_preferences`. This table records opt-in/opt-out settings per
channel (`sms`, `email`, `push`) and category (`security`, `lifecycle`,
`marketing`).

Security category notifications cannot be disabled at the application layer,
regardless of the stored value.

### PII considerations

The table contains only `user_id` references and preference flags — no
phone numbers, emails, or other PII. The `user_id` is a UUID and can be used
to look up contact details in the `users` table if needed.

---

## 8. Blockchain data

### What goes on-chain

| Data                      | Stored on Stellar? | Notes                               |
| ------------------------- | ------------------ | ----------------------------------- |
| USDC amount               | Yes                | In escrow contract storage          |
| Sender Stellar address    | Yes                | Public key (pseudonymous)           |
| Recipient Stellar address | Yes                | Derived from phone hash — see below |
| Unlock timestamp          | Yes                | Unix timestamp                      |
| Transaction hash          | Yes                | Public                              |

### Phone-to-address mapping

The recipient's Stellar address is **not** directly derived from their phone
number. The platform generates or assigns a Stellar address for the recipient
at claim time. Phone numbers do not appear on-chain.

### Immutability

Blockchain data is **permanent and cannot be deleted**. Stellar transaction
history and contract state snapshots are publicly accessible. Senders and
recipients should be aware that USDC amounts and Stellar addresses are
permanently visible on the public ledger.

---

## 9. Retention periods

| Data category                      | Retention period                    | Basis                              |
| ---------------------------------- | ----------------------------------- | ---------------------------------- |
| Audit logs                         | 7 years minimum                     | AML / NDPR financial records       |
| Gift records (claimed/expired)     | 7 years                             | Financial records                  |
| Active gift records                | Until claimed or expired + 7 years  | Financial records                  |
| User accounts                      | Until account deletion request      | Consent                            |
| OTP codes (Redis)                  | 5 minutes (TTL)                     | Transient authentication           |
| Gift invitations (expired/claimed) | 30 days from expiry                 | Minimal retention                  |
| Media (Cloudinary)                 | Until gift deletion                 | Consent                            |
| Session tokens                     | Session duration + configurable TTL | Authentication                     |
| Device tracking records            | 90 days (recommended)               | Fraud prevention                   |
| Payment references                 | 7 years                             | Financial records (via audit logs) |

---

## 10. Deletion and erasure

### User account deletion

When a user requests account deletion (right to erasure under GDPR/NDPR):

1. **Soft-delete** the user record: set a `deleted_at` timestamp, clear
   `phone` and any other PII fields in the `users` table.
2. **Nullify** `recipient_phone` in any `gift_invitations` rows associated
   with the user's phone hash.
3. **Delete** active session tokens from Redis.
4. **Do not delete** audit log entries — these are required for financial
   compliance and are append-only by database rule.
5. **Do not delete** gift records — these are financial records. The `user_id`
   reference becomes a tombstone.
6. **Delete Cloudinary assets** for any gifts created by the user using the
   Cloudinary Destroy API.
7. Log the deletion event in `audit_logs` with `event_type = 'account_deleted'`.

### Gift invitation purge (routine)

Expired and claimed invitation records should be purged regularly:

```sql
DELETE FROM gift_invitations
WHERE status IN ('expired', 'claimed')
  AND expires_at < NOW() - INTERVAL '30 days';
```

Run this as a scheduled cron job or include in the nightly maintenance window.

### Data that cannot be deleted

| Data                                 | Reason                                              |
| ------------------------------------ | --------------------------------------------------- |
| Stellar transaction history          | Blockchain is immutable                             |
| Audit log entries                    | PostgreSQL `NO DELETE` rule; 7-year compliance hold |
| Gift records with financial activity | AML record-keeping requirement                      |

---

## 11. Data flow diagram

```
User (browser)
      │
      ├── Phone number (OTP auth) ──────────────────► Termii (SMS OTP)
      │                                                [transient, not stored]
      │
      ├── Creates gift ─────────────────────────────► PostgreSQL (gift record)
      │     ├── Sender phone ──────────────────────►    users.phone (plaintext)
      │     ├── Recipient phone ─── SHA-256 hash ──►    gifts.recipient_phone_hash
      │     ├── Recipient phone (SMS) ─────────────►  Termii (transient)
      │     └── Media upload ───────────────────────► Cloudinary (CDN)
      │
      ├── Initiates payment (NGN) ──────────────────► Paystack (PCI-DSS)
      │     └── Callback reference ─────────────────► PostgreSQL (gifts.paystack_reference)
      │
      ├── Initiates payment (international) ─────────► Stripe (PCI-DSS)
      │     └── payment_intent.succeeded event ──────► PostgreSQL (gifts.status = locked)
      │
      └── Gift locked ─────────────────────────────► Stellar Soroban escrow contract
                                                       [amount, addresses, unlock time — public]

All financial operations ────────────────────────────► PostgreSQL (audit_logs, append-only)
                                                        [7-year retention]
```

---

## Related documents

- `SECURITY.md` — vulnerability reporting
- `TERMS.md` — terms of service including data handling disclosures
- `docs/audit/AUDIT_PLAN.md` — SQL injection and security audit plan
- `docs/ops/database-backup.md` — database backup and recovery
- `migrations/0003_hash_recipient_phone.sql` — phone hashing migration
- `migrations/0005_audit_logs.sql` — audit log schema
