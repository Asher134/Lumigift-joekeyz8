# Data deletion and subject-access workflows

Issue: #145 · Owner: Backend – Auth · Review: yearly, or whenever a new table stores personal data.

## Endpoints

| Workflow         | Endpoint                      | Auth                                       | Rate limit      |
| ---------------- | ----------------------------- | ------------------------------------------ | --------------- |
| Export (access)  | `GET /api/v1/users/me/export` | Session                                    | 5 / user / day  |
| Erasure (delete) | `DELETE /api/v1/users/me`     | Session + CSRF + **fresh OTP** in the body | OTP lockout (5) |

Both endpoints act only on the signed-in user's own data. Neither takes a user ID as input, so neither can be pointed at another user (no IDOR).

Erasure needs a newly issued OTP (`POST /api/v1/auth/send-otp`). A stolen session cookie alone cannot delete an account.

## Auditing

Every request is recorded twice:

1. In `data_subject_requests` (migration `0008`), with its type, outcome, rejection reason, IP address and user agent.
2. In the append-only `audit_logs` table, with one of these events:
   - `data_export_requested`
   - `data_deletion_requested`
   - `data_deletion_rejected`, with a reason of `verification_failed` or `active_gifts`
   - `data_deletion_completed`

## What erasure does

| Data                                               | Action                                                         |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `users.phone`, `users.name`                        | Overwritten (`deleted:<id>`, `Deleted user`); `deleted_at` set |
| `user_notification_preferences`                    | Deleted                                                        |
| `known_devices`                                    | Deleted                                                        |
| `suspicious_login_reports`                         | Deleted                                                        |
| `gift_invitations.recipient_phone`                 | Overwritten with `[redacted]` (the hash is kept)               |
| Sent gifts: recipient name, email, message, media  | Redacted                                                       |
| Sent gifts: amounts, status, tx hashes, phone hash | **Retained**, see the exceptions below                         |
| `audit_logs`                                       | **Retained**, see the exceptions below                         |

The `users` row itself is kept, holding only pseudonymous data, so that gifts, payments and audit rows stay linked.

Erasure is **refused** (`409 ACCOUNT_HAS_ACTIVE_GIFTS`) while any gift the user sent is `pending_payment`, `funded`, `locked` or `unlocked`. Deleting at that point would leave money in escrow with no one able to recover it. The user must first cancel those gifts (see [gift-cancellation-policy.md](../product/gift-cancellation-policy.md)), or wait for them to be claimed.

## Retention exceptions

These records survive an erasure request. Each has a legal or operational basis. Where possible they are pseudonymised instead of kept in clear.

| Record                              | Retained fields                                                         | Why                                                                                                                             | Retention period |
| ----------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `audit_logs`                        | user ID, gift ID, amounts, timestamp, IP, UA, metadata                  | Financial audit trail; AML/CFT record-keeping; dispute resolution. The table is append-only at the DB level (migration `0005`). | 7 years          |
| Gift financial fields               | amounts (NGN/USDC), status, Stellar tx hashes, recipient phone **hash** | Reconciliation against Paystack and on-chain escrow; refunds and chargebacks.                                                   | 7 years          |
| On-chain escrow data                | sender/recipient Stellar addresses, amounts                             | Immutable public ledger. We cannot delete it.                                                                                   | Permanent        |
| Payment provider records (Paystack) | Held by the processor under their policy                                | Outside our control. We cannot erase it.                                                                                        | Processor policy |
| `data_subject_requests`             | The request log itself                                                  | Evidence that the request was handled                                                                                           | 7 years          |
| Application logs                    | See [log-retention-policy.md](../ops/log-retention-policy.md)           | Operations                                                                                                                      | Per that policy  |
| Database backups                    | Snapshot copies                                                         | Disaster recovery. Erased rows age out on the backup rotation in [database-backup.md](../ops/database-backup.md).               | Backup rotation  |

Once a record passes its retention period, a scheduled purge job should delete or fully anonymise it. That job is a follow-up and is not part of this change.

## Export format

The export is JSON (`formatVersion: "1"`) containing:

- `profile`
- `notificationPreferences`
- `knownDevices`
- `giftsSent`
- `giftsReceived`: the sender's ID and the recipient phone hash are stripped, because they are another person's identifiers
- `auditTrail`
- `dataSubjectRequests`

It is served with `Content-Disposition: attachment` and `Cache-Control: no-store`.
