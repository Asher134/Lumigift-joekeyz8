# Uptime Monitoring

> **Status page**: https://status.lumigift.app
>
> This document describes the uptime monitoring setup for Lumigift's critical endpoints and infrastructure.
> Monitoring is provisioned via **BetterUptime** and covers `/api/health`, `/api/health/ready`, and external
> Stellar dependencies. Alerts fire on **2 consecutive failures** via email and Slack.

<!-- Closes #300 -->

## Monitored Endpoints

| Endpoint                                    | Check Interval  | Alert Threshold        |
| ------------------------------------------- | --------------- | ---------------------- |
| `GET /api/health`                           | 1 minute (60 s) | 2 consecutive failures |
| `GET /api/health/ready`                     | 1 minute (60 s) | 2 consecutive failures |
| Stellar Horizon API (`STELLAR_HORIZON_URL`) | 1 minute        | 2 consecutive failures |
| Soroban RPC (`STELLAR_RPC_URL`)             | 5 minutes       | 2 consecutive failures |

## Setup: BetterUptime (Recommended)

[BetterUptime](https://betteruptime.com) provides monitors, on-call schedules, and a hosted status page.

### 1. Create Monitors

Log in to BetterUptime and create the following monitors:

**Monitor 1 — App Liveness (`/api/health`)**

- URL: `https://<your-domain>/api/health`
- Method: `GET`
- Check frequency: **60 seconds**
- Expected status: `200`
- Expected response body contains: `"status":"ok"`
- Alert after: **2 consecutive failures**
- Alert via: **Email** + **Slack** (`#incidents`)

**Monitor 2 — App Readiness (`/api/health/ready`)**

- URL: `https://<your-domain>/api/health/ready`
- Method: `GET`
- Check frequency: **60 seconds**
- Expected status: `200`
- Alert after: **2 consecutive failures**
- Alert via: **Email** + **Slack** (`#incidents`)

**Monitor 3 — Stellar Horizon**

- URL: `https://horizon.stellar.org/` (mainnet) or `https://horizon-testnet.stellar.org/` (testnet)
- Method: `GET`
- Check frequency: **1 minute**
- Expected status: `200`
- Alert after: **2 consecutive failures**

**Monitor 4 — Soroban RPC**

- URL: `https://soroban-rpc.stellar.org` (mainnet) or `https://soroban-testnet.stellar.org` (testnet)
- Method: `POST`
- Request body: `{"jsonrpc":"2.0","id":1,"method":"getHealth"}`
- Headers: `Content-Type: application/json`
- Check frequency: **5 minutes**
- Expected status: `200`
- Alert after: **2 consecutive failures**

### 2. Configure Email & Slack Alerts

**Email alerts:**

1. In BetterUptime → **On-call** → **Contacts** → add on-call engineer email addresses.
2. Assign contacts to each monitor under **Notifications**.
3. Set alert policy: notify after **2 consecutive failures**.

**Slack alerts:**

1. BetterUptime → **Integrations** → **Slack** → connect workspace.
2. Select the `#incidents` channel.
3. Assign the Slack integration to each monitor under **Notifications**.

### 3. Status Page

1. In BetterUptime → **Status Pages** → **New Status Page**.
2. Add the four monitors above as components:
   - "Lumigift App" → `/api/health` monitor
   - "API Readiness" → `/api/health/ready` monitor
   - "Stellar Network" → Horizon monitor
   - "Smart Contracts" → Soroban RPC monitor
3. Set a custom domain: `status.lumigift.app` via CNAME to BetterUptime's endpoint.
4. The status page URL is listed in the project README (see `README.md`).

> **Status page URL**: https://status.lumigift.app

## Alternative: Statuspage.io

If using Atlassian Statuspage:

1. Create components matching the three monitors above.
2. Use the Statuspage API or a cron job to update component status based on health check results.
3. Configure PagerDuty or email notifications for subscribers.

## Incident Response

When an alert fires:

1. **Acknowledge** the alert in PagerDuty within 15 minutes.
2. **Diagnose** using the runbook: `docs/ops/runbook.md`.
3. **Update** the status page with an incident note.
4. **Resolve** the alert once the endpoint recovers.
5. **Post-mortem**: For P0/P1 incidents, file a post-mortem within 48 hours.

### Quick Diagnosis Commands

```bash
# Check app health
curl -s https://<your-domain>/api/health | jq .

# Check Stellar Horizon
curl -s https://horizon.stellar.org/ | jq .status

# Check Soroban RPC
curl -s -X POST https://soroban-rpc.stellar.org \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq .
```

## Environment Variables

No additional environment variables are required for monitoring. The monitors call public endpoints.

If you add authenticated monitoring (e.g., a `/api/health/deep` endpoint that checks DB connectivity), add a `HEALTH_CHECK_SECRET` env var and pass it as a Bearer token in the monitor's request headers.

## Reviewing Monitor Status

- BetterUptime dashboard: https://betteruptime.com/team/monitors
- Status page: https://status.lumigift.app
- PagerDuty incidents: https://lumigift.pagerduty.com/incidents

---

## On-Call Rotation

On-call responsibilities rotate weekly. The schedule is managed in BetterUptime under
**On-call** → **Schedules** → `lumigift-primary`.

### Rotation Schedule

| Week   | On-Call Engineer  | Backup            |
| ------ | ----------------- | ----------------- |
| Week 1 | Engineering Lead  | Senior Engineer A |
| Week 2 | Senior Engineer A | Senior Engineer B |
| Week 3 | Senior Engineer B | Engineering Lead  |
| Week 4 | (repeat)          | —                 |

> Update this table in BetterUptime's schedule UI. The table above is kept in sync
> manually each quarter.

### On-Call Responsibilities

- Acknowledge alerts within **15 minutes** (P0/P1).
- Follow the incident runbook at `docs/ops/runbook.md`.
- Update the status page during active incidents.
- Hand off any ongoing incidents at rotation changeover.

### Escalation Contacts

| Role             | Contact Method             |
| ---------------- | -------------------------- |
| On-call engineer | BetterUptime / Slack DM    |
| Engineering Lead | Slack `#incidents` + phone |
| CTO (P0 only)    | Direct call                |

_Section added for Issue #300_
