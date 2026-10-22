# Email Setup: SPF, DKIM, and DMARC for Transactional Emails

> **Related issue:** #314  
> **Priority:** Medium — without these DNS records, transactional emails (OTP codes, gift notifications) are likely to land in spam and can be spoofed by third parties.

---

## Overview

Lumigift sends transactional emails from `src/lib/email.ts`. To ensure reliable delivery and prevent spoofing, three DNS-level email authentication mechanisms must be configured for the sending domain:

| Mechanism | Purpose |
| --------- | ------- |
| **SPF** (Sender Policy Framework) | Authorises specific mail servers to send email on behalf of your domain |
| **DKIM** (DomainKeys Identified Mail) | Cryptographically signs outgoing mail so recipients can verify authenticity |
| **DMARC** (Domain-based Message Authentication, Reporting, and Conformance) | Defines what to do with mail that fails SPF/DKIM, and enables reporting |

---

## Prerequisites

Before starting:

- Access to the DNS provider for the sending domain (e.g. Route 53, Cloudflare, Namecheap).
- Access to the email sending service dashboard (e.g. Resend, SendGrid, Mailgun, AWS SES — see `.env.example` for which provider is configured).
- A test account at [mail-tester.com](https://www.mail-tester.com) to verify deliverability after setup.

---

## Step 1 — SPF Record

SPF tells receiving mail servers which IP addresses or services are allowed to send email for your domain.

### Add a DNS TXT record

| Field | Value |
| ----- | ----- |
| **Type** | `TXT` |
| **Name / Host** | `@` (the root domain, e.g. `lumigift.app`) |
| **Value** | See below |
| **TTL** | `3600` (1 hour) |

**Example SPF value (Resend):**

```
v=spf1 include:amazonses.com ~all
```

**Example SPF value (SendGrid):**

```
v=spf1 include:sendgrid.net ~all
```

**Example SPF value (custom SMTP server):**

```
v=spf1 ip4:<YOUR_MAIL_SERVER_IP> ~all
```

> Replace `include:` with the value provided by your email provider. If you use multiple providers, chain them:
> `v=spf1 include:amazonses.com include:sendgrid.net ~all`

**Mechanism meanings:**

| Mechanism | Meaning |
| --------- | ------- |
| `~all` | Soft fail — treat unauthorised senders as suspicious (recommended to start) |
| `-all` | Hard fail — reject unauthorised senders outright (use once SPF is confirmed working) |

### Verify SPF

```bash
dig TXT lumigift.app | grep spf
# or
nslookup -type=TXT lumigift.app
```

---

## Step 2 — DKIM Keys

DKIM adds a cryptographic signature to each outgoing email. The receiving server checks the signature against the public key published in your DNS.

### Option A — Provider-managed DKIM (recommended)

Most email providers (Resend, SendGrid, AWS SES, Mailgun) generate DKIM keys for you. Follow the provider's domain verification wizard:

1. Log in to your email provider's dashboard.
2. Navigate to **Domains** (or **Sender Authentication**).
3. Add your sending domain (e.g. `lumigift.app`).
4. The provider will display one or more DNS records to add — typically a `CNAME` or `TXT` record like:

   | Field | Value |
   | ----- | ----- |
   | **Type** | `CNAME` or `TXT` |
   | **Name** | `resend._domainkey.lumigift.app` (example) |
   | **Value** | `<provided by your email provider>` |

5. Add these records to your DNS provider.
6. Return to the dashboard and click **Verify** — wait up to 48 hours for DNS propagation.

### Option B — Self-managed DKIM keys

If you manage your own mail server, generate a 2048-bit RSA keypair:

```bash
# Generate private key
openssl genrsa -out dkim_private.key 2048

# Extract public key
openssl rsa -in dkim_private.key -pubout -out dkim_public.key

# Format for DNS (strip headers and newlines)
grep -v "^-" dkim_public.key | tr -d '\n'
```

Add a DNS TXT record:

| Field | Value |
| ----- | ----- |
| **Type** | `TXT` |
| **Name** | `<selector>._domainkey.lumigift.app` (e.g. `mail._domainkey`) |
| **Value** | `v=DKIM1; k=rsa; p=<base64-public-key>` |

Configure your mail server to sign outgoing mail with `dkim_private.key` using the matching selector.

> ⚠️ **Security:** Store the private key in a secrets manager (AWS Secrets Manager, HashiCorp Vault). Never commit it to the repository.

### Verify DKIM

```bash
# Replace 'mail' with your selector and 'lumigift.app' with your domain
dig TXT mail._domainkey.lumigift.app
```

---

## Step 3 — DMARC Policy

DMARC tells receiving servers what to do when an email fails SPF and/or DKIM checks, and where to send aggregate reports.

### Add a DNS TXT record

| Field | Value |
| ----- | ----- |
| **Type** | `TXT` |
| **Name** | `_dmarc.lumigift.app` |
| **Value** | See below |
| **TTL** | `3600` |

**Recommended starting policy (`p=none` — monitoring only):**

```
v=DMARC1; p=none; rua=mailto:dmarc-reports@lumigift.app; ruf=mailto:dmarc-reports@lumigift.app; fo=1
```

**Graduated policy path:**

| Phase | Policy | When to use |
| ----- | ------- | ----------- |
| 1 — Monitor | `p=none` | Immediately after setup — collect reports without affecting delivery |
| 2 — Quarantine | `p=quarantine` | After reviewing reports and confirming all legitimate mail passes — routes failing mail to spam |
| 3 — Reject | `p=reject` | After sustained clean reports — outright rejects mail that fails authentication |

> The issue acceptance criteria require `p=quarantine`. Move to this policy after at least 2 weeks of clean `p=none` reports. Set `pct=10` first to apply the policy to only 10% of failing mail, then increase to 100%.

**Example quarantine policy:**

```
v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc-reports@lumigift.app; ruf=mailto:dmarc-reports@lumigift.app; fo=1
```

**DMARC tag reference:**

| Tag | Description |
| --- | ----------- |
| `p=` | Policy: `none`, `quarantine`, or `reject` |
| `pct=` | Percentage of failing mail to apply policy to (default: 100) |
| `rua=` | Aggregate report destination (daily digest) |
| `ruf=` | Forensic report destination (per-failure) |
| `fo=1` | Send forensic reports when any authentication check fails |
| `adkim=s` | Strict DKIM alignment (optional, use once stable) |
| `aspf=s` | Strict SPF alignment (optional, use once stable) |

### Verify DMARC

```bash
dig TXT _dmarc.lumigift.app
```

---

## Step 4 — Verify Deliverability

After adding all three DNS records (allow up to 48 hours for propagation):

1. Go to [https://www.mail-tester.com](https://www.mail-tester.com).
2. Copy the unique test address shown (e.g. `test-xyz@mail-tester.com`).
3. Send a real transactional email from the application to that address (trigger an OTP or gift notification).
4. Return to mail-tester.com and click **Then check your score**.
5. The target score is **≥ 9/10**.

**Common issues and fixes:**

| Score deduction | Likely cause | Fix |
| --------------- | ------------ | --- |
| SPF missing / failing | SPF record not added or propagated | Double-check DNS TXT record and wait for propagation |
| DKIM missing / invalid | DKIM record not added or key mismatch | Re-verify in email provider dashboard |
| DMARC missing | `_dmarc` record not added | Add DMARC TXT record |
| Spam content | Email body contains spam-trigger words | Review email templates in `src/lib/email.ts` |
| No unsubscribe header | Bulk/marketing mail without List-Unsubscribe | Add `List-Unsubscribe` header to non-transactional mail |

---

## Step 5 — Monitor DMARC Reports

Once DMARC is active, aggregate reports (`rua`) arrive daily as XML email attachments. Use a DMARC report parser to make them readable:

- [DMARC Analyzer](https://www.dmarcanalyzer.com) (free tier available)
- [Postmark DMARC](https://dmarc.postmarkapp.com) (free)
- [Google Postmaster Tools](https://postmaster.google.com) (for Gmail delivery insights)

Review reports weekly during the first month. Look for:
- Legitimate mail failing SPF or DKIM (fix the source)
- Unknown sources sending from your domain (investigate spoofing)

---

## DNS Record Summary

After completing all steps, your domain should have the following records:

```
lumigift.app.                 TXT  "v=spf1 include:<provider> ~all"
<selector>._domainkey.lumigift.app.  TXT  "v=DKIM1; k=rsa; p=<public-key>"
_dmarc.lumigift.app.          TXT  "v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc-reports@lumigift.app"
```

---

## Security Notes

- **Never commit DKIM private keys.** Store them in AWS Secrets Manager or equivalent.
- **Rotate DKIM keys annually.** Generate a new keypair, publish the new public key under a new selector, update your mail server config, then remove the old DNS record after 48 hours.
- **Use `p=reject` as the long-term target.** `p=quarantine` is a stepping stone; move to `p=reject` once you have 4+ weeks of clean aggregate reports.
- **Monitor the `ruf` forensic reports** for indications of phishing campaigns using your domain.

---

## Related Resources

- [Stellar / Postmark SPF docs](https://postmarkapp.com/guides/spf)
- [DKIM.org specification](http://dkim.org/)
- [DMARC.org specification](https://dmarc.org/)
- [MXToolbox Email Health Check](https://mxtoolbox.com/emailhealth/)
- [`src/lib/email.ts`](../../src/lib/email.ts) — Lumigift email sending implementation
- [`docs/ops/runbook.md`](runbook.md) — Production incident runbook

---

*Last reviewed: 2026-10-20. Review when the email provider or sending domain changes.*
