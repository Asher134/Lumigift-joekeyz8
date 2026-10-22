# Log Aggregation (Loki)

> **Issue #337** — Centralised log aggregation for querying across instances and time windows.

Structured pino logs (`src/lib/logger.ts`) are shipped by **Promtail** to **Loki** and
explored in **Grafana**. Config lives in [`infra/logging/`](../../infra/logging).

```bash
docker compose -f docker-compose.yml -f infra/logging/docker-compose.logging.yml up -d
```

| Component | Config                                         | Purpose                             |
| --------- | ---------------------------------------------- | ----------------------------------- |
| Promtail  | `infra/logging/promtail-config.yml`            | Tails container stdout, parses JSON |
| Loki      | `infra/logging/loki-config.yml`                | Storage, retention, ruler           |
| Alerts    | `infra/logging/rules/fake/lumigift-alerts.yml` | Error-rate alert                    |
| Grafana   | `infra/logging/grafana/datasources.yml`        | Dashboard / Explore (port 3001)     |

## Querying

`level`, `service`, `env` and `log_type` are labels. `requestId` (falls back to
`correlationId`), `userId` and `giftId` are stored as structured metadata.

```logql
{app="lumigift"} | requestId="9b1c…"
{app="lumigift"} | userId="usr_123"
{app="lumigift"} | giftId="gift_abc"
{app="lumigift", level="error"}
```

## Retention

Enforced by the Loki compactor, matching [log-retention-policy.md](./log-retention-policy.md):

| Stream                                | Retention |
| ------------------------------------- | --------- |
| Application & error logs (default)    | 30 days   |
| Audit logs (`log_type="audit"`)       | 90 days   |
| Security/auth logs (`service="auth"`) | 90 days   |

## Alerting

`LumigiftHighErrorRate` fires when `error`/`fatal` lines exceed **1%** of all log lines
over a 5-minute window. Set `ALERTMANAGER_URL` for Loki's ruler to route it.

## Dashboard

Grafana Explore: `${GRAFANA_URL:-http://localhost:3001}/explore` (datasource **Loki**).
