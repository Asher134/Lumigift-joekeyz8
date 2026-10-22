# Security Incident Response Playbook

> **Location:** `docs/security/incident-response.md`  
> **Related issue:** #319  
> **Priority:** High  
> **Review cadence:** Annually, or after any significant infrastructure or team change.  
> **Last reviewed:** 2026-10-20 — *update this date after each annual review.*

---

## Purpose

This playbook defines the internal process for responding to confirmed or suspected security incidents affecting Lumigift. It is intended for use by the engineering team, on-call engineers, and security contacts.

For instructions on **reporting** a vulnerability from outside the team, see [SECURITY.md](../../SECURITY.md).

---

## Escalation Contacts

| Role | Contact | Availability |
| ---- | ------- | ------------ |
| Security Lead | `security@lumigift.com` | Primary point of contact for all security incidents |
| Engineering Lead | *(fill in: name + Slack handle)* | On-call during business hours; page for P0 |
| On-Call Engineer | *(fill in: PagerDuty / Opsgenie rotation)* | 24/7 for P0/P1 |
| Legal / Compliance | *(fill in: name + email)* | Required for data breaches involving user PII |
| CEO / Founder | *(fill in: name + contact)* | Notify for P0 incidents and mandatory disclosures |

> **Action:** Fill in concrete names and handles before this playbook goes live. Store sensitive contact details in a private runbook or 1Password vault rather than in this public document.

---

## Severity Classification

| Level | Name | Examples | Response SLA |
| ----- | ---- | -------- | ------------ |
| P0 | Critical | Smart contract exploit, active fund drain, full auth bypass, production database compromise | Immediate — wake on-call now |
| P1 | High | Partial auth bypass, secret exposure, ransomware detection, data exfiltration in progress | < 1 hour |
| P2 | Medium | Dependency with known CVE exploitable in production, account takeover of non-admin user | < 4 hours |
| P3 | Low | Expired certificate, low-severity CVE, misconfigured security header | < 24 hours |

---

## Phases

### Phase 1 — Detection

**Goal:** Identify that an incident may be occurring and gather initial evidence.

**Sources of detection:**

- Automated alerts: Sentry errors, Vercel anomaly alerts, DataDog monitors, GitHub secret scanning, Dependabot security advisories.
- External reports: responsible disclosure via `security@lumigift.com` (see [SECURITY.md](../../SECURITY.md)).
- User reports: support tickets, social media, direct messages.
- Routine monitoring: audit log review, access log anomalies.

**Initial checklist:**

- [ ] Note the exact time and source of the alert or report.
- [ ] Assign a preliminary severity (P0–P3) based on the classification table above.
- [ ] Open an incident channel: create a private Slack channel named `#incident-YYYY-MM-DD-<short-description>`.
- [ ] Notify the on-call engineer and security lead immediately for P0/P1.
- [ ] Do **not** discuss details in public channels or external platforms until containment is confirmed.

---

### Phase 2 — Triage

**Goal:** Confirm whether an incident is real, scope its impact, and escalate appropriately.

**Checklist:**

- [ ] Reproduce or verify the reported behaviour in a safe environment (do not interact directly with potentially compromised production systems without containment controls in place).
- [ ] Determine the affected components: which services, APIs, database tables, or smart contract functions are impacted.
- [ ] Estimate the blast radius: number of users affected, volume of data exposed, funds at risk.
- [ ] Re-classify severity if new information changes the initial assessment.
- [ ] Assign an Incident Commander (IC) — the IC owns the incident until resolution. For P0/P1 this should be the Engineering Lead or Security Lead.
- [ ] If user PII or financial data is confirmed or suspected to be exposed, notify Legal immediately.
- [ ] Escalate to P0 contacts if severity warrants it (see Escalation Contacts above).

---

### Phase 3 — Containment

**Goal:** Stop the incident from spreading or causing further damage.

**Short-term containment (< 30 minutes for P0):**

- [ ] **Revoke compromised credentials.** Rotate all secrets that may have been exposed (API keys, JWT secrets, database passwords, DKIM private keys). Use `scripts/generate-secrets.sh` and update environment secrets in Vercel / AWS Secrets Manager.
- [ ] **Block attacker access.** If the attacker's IP is known, add a WAF rule or IP block at the infrastructure level. Invalidate active sessions for affected accounts.
- [ ] **Disable affected functionality.** If a specific API endpoint or smart contract function is being exploited, disable it via a feature flag or emergency deployment. For the smart contract, the `set_admin` / upgrade path can disable operations — consult [`docs/ops/contract-migration.md`](contract-migration.md).
- [ ] **Snapshot the affected state.** Before making changes, capture logs, database snapshots, and network traffic captures as forensic evidence. Do not alter evidence.
- [ ] **Preserve Stellar transaction history.** Horizon and on-chain records are immutable — record all relevant transaction IDs and ledger numbers.

**Long-term containment (before eradication):**

- [ ] Deploy a hotfix to a staging environment and validate it does not break other functionality.
- [ ] For database compromises: place affected tables in read-only mode while forensic analysis completes.
- [ ] Communicate status to stakeholders via the `#incidents` Slack channel. Keep updates factual and avoid speculation.

---

### Phase 4 — Eradication

**Goal:** Remove the root cause of the incident.

**Checklist:**

- [ ] Identify the root cause (vulnerability, misconfiguration, compromised credential, social engineering, etc.).
- [ ] Patch or remediate the root cause:
  - Code vulnerability → develop, review, and deploy a patch.
  - Compromised secret → rotate credentials, audit access logs for misuse period.
  - Malicious dependency → remove or pin to a clean version, run `npm audit fix` / `cargo audit`.
  - Smart contract vulnerability → prepare an upgrade; see [`docs/ops/contract-migration.md`](contract-migration.md).
- [ ] Run the full test suite (`npm test`, `npm run contract:test`) against the fix.
- [ ] Confirm via independent review (second engineer) that the root cause is addressed.
- [ ] Remove any temporary mitigations (feature flags, WAF rules, IP blocks) that are no longer needed once the fix is deployed.

**Responsible disclosure timeline:**

| Severity | Patch target | Public disclosure |
| -------- | ------------ | ----------------- |
| P0 Critical | **72 hours** from confirmation | After patch is deployed and majority of users are protected |
| P1 High | 7 days | After patch is deployed |
| P2 Medium | 30 days | After patch is deployed |
| P3 Low | Next scheduled release | At time of release |

> The 72-hour patch target for critical vulnerabilities is the commitment made in [SECURITY.md](../../SECURITY.md). If a patch is not technically feasible within 72 hours, escalate to the Security Lead and CEO, implement the best available mitigation, and communicate transparently with affected parties.

---

### Phase 5 — Recovery

**Goal:** Restore normal operations safely.

**Checklist:**

- [ ] Deploy the patched code to production via the standard CI/CD pipeline (do not bypass CI).
- [ ] Verify the fix in production using smoke tests and the endpoints documented in [`scripts/smoke-test.sh`](../../scripts/smoke-test.sh).
- [ ] Restore any disabled features or functionality.
- [ ] Re-enable any WAF rules or rate limits that were temporarily tightened.
- [ ] Monitor application logs and error rates for 24–48 hours after deployment to confirm stability.
- [ ] If user accounts were compromised, notify affected users per the communication plan below.
- [ ] If a data breach occurred involving EU/UK users, assess GDPR notification obligations (72-hour window to notify the relevant supervisory authority). Involve Legal.

**User communication template:**

> We recently identified and resolved a security issue affecting [describe scope]. We have taken the following steps: [list actions]. [If data was exposed: We have found that [describe data]. We recommend you [specific user action such as reset password].] We apologise for any concern this may cause and remain committed to the security of your account.

---

### Phase 6 — Post-Mortem

**Goal:** Learn from the incident to prevent recurrence.

A blameless post-mortem must be completed for all P0 and P1 incidents, and is recommended for P2.

**Timeline:** Post-mortem document drafted within **5 business days** of incident resolution.

**Post-mortem document outline:**

```
## Incident Post-Mortem: <Title>

**Date:** YYYY-MM-DD  
**Severity:** P0 / P1 / P2  
**Duration:** <time from detection to recovery>  
**Incident Commander:** <name>  

### Summary
One paragraph describing what happened.

### Timeline
| Time (UTC) | Event |
|---|---|
| HH:MM | Alert triggered / report received |
| HH:MM | Incident confirmed |
| HH:MM | Containment action taken |
| HH:MM | Root cause identified |
| HH:MM | Patch deployed |
| HH:MM | Incident resolved |

### Root Cause
Detailed description of the root cause.

### Impact
- Users affected: <number or range>
- Data exposed: <yes/no — describe if yes>
- Funds at risk / lost: <amount if applicable>
- Downtime: <duration>

### What Went Well
- ...

### What Could Be Improved
- ...

### Action Items
| Action | Owner | Due date |
|---|---|---|
| <specific improvement> | <name> | YYYY-MM-DD |
```

Post-mortems are stored in `docs/security/post-mortems/` and reviewed at the next team retrospective.

---

## Annual Review Checklist

This playbook must be reviewed annually (or after any significant infrastructure or team change) by the security contact. During the review:

- [ ] Verify all escalation contact details are current.
- [ ] Confirm the patch timelines still reflect team capacity and contractual SLAs.
- [ ] Update the playbook to reflect any tooling changes (new alert sources, changed runbook links, updated CLI commands).
- [ ] Conduct a tabletop exercise with the engineering team: walk through a hypothetical P0 scenario end-to-end.
- [ ] Update the "Last reviewed" date at the top of this document.

---

## Related Documents

- [SECURITY.md](../../SECURITY.md) — external vulnerability reporting policy
- [`docs/ops/runbook.md`](../ops/runbook.md) — production incident runbook (database, Redis, API failures)
- [`docs/ops/key-rotation.md`](../ops/key-rotation.md) — credential rotation procedures
- [`docs/ops/contract-migration.md`](../ops/contract-migration.md) — smart contract upgrade procedure
- [`docs/security/pentest-2026-09.md`](pentest-2026-09.md) — most recent penetration test results
- [`docs/privacy-data-retention.md`](../privacy-data-retention.md) — data retention and GDPR guidance
