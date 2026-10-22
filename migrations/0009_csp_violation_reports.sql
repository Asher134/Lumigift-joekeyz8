-- Migration: 0009_csp_violation_reports
-- Issue #301 — CSP reporting endpoint
--
-- Creates the table that stores Content Security Policy violation reports
-- received at POST /api/v1/csp-report.
--
-- An index on `reported_at` supports time-range queries (e.g. dashboards
-- showing violation spikes in the last 24 h / 7 d).
-- An index on `effective_directive` supports grouping by directive type.

CREATE TABLE IF NOT EXISTS csp_violation_reports (
    id                  BIGSERIAL     PRIMARY KEY,
    document_uri        TEXT,
    referrer            TEXT,
    violated_directive  TEXT,
    effective_directive TEXT,
    blocked_uri         TEXT,
    disposition         TEXT          CHECK (disposition IN ('enforce', 'report') OR disposition IS NULL),
    original_policy     TEXT,
    source_file         TEXT,
    line_number         INTEGER,
    column_number       INTEGER,
    status_code         INTEGER,
    script_sample       TEXT,
    reported_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    client_ip           TEXT
);

-- Time-range queries (dashboards, spike detection)
CREATE INDEX IF NOT EXISTS idx_csp_violations_reported_at
    ON csp_violation_reports (reported_at DESC);

-- Grouping / filtering by directive
CREATE INDEX IF NOT EXISTS idx_csp_violations_directive
    ON csp_violation_reports (effective_directive);

-- Optional: auto-purge reports older than 90 days (run via cron or pg_cron)
-- DELETE FROM csp_violation_reports WHERE reported_at < NOW() - INTERVAL '90 days';
