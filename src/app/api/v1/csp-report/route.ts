/**
 * POST /api/v1/csp-report
 *
 * Accepts Content Security Policy (CSP) violation reports from browsers.
 * Browsers send reports automatically when a CSP violation occurs and the
 * `report-uri` or `report-to` directive is set in the CSP header.
 *
 * Security design:
 *  - Rate-limited per IP (60 reports / minute) to prevent denial-of-service abuse.
 *  - Body size capped at 16 KB — reports are tiny; large payloads are rejected.
 *  - Reports are stored in `csp_violation_reports` and forwarded to Sentry.
 *  - No auth required — browsers send reports without credentials.
 *  - Endpoint is explicitly excluded from CSRF middleware (browser-sent, not
 *    user-initiated form submissions).
 *
 * Spec: https://www.w3.org/TR/CSP3/#violation-reports
 *
 * Closes #301
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import pool from "@/lib/db";
import { rateLimit } from "@/server/middleware";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum accepted body size in bytes (16 KB). */
const MAX_BODY_BYTES = 16_384;

/** Rate limit: at most 60 reports per IP per minute. */
const RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * CSP Level 3 report-uri format (sent as `application/csp-report`).
 * https://www.w3.org/TR/CSP3/#violation-report
 */
interface CspReportBody {
  "csp-report": {
    "document-uri"?: string;
    referrer?: string;
    "violated-directive"?: string;
    "effective-directive"?: string;
    "original-policy"?: string;
    disposition?: "enforce" | "report";
    "blocked-uri"?: string;
    "line-number"?: number;
    "column-number"?: number;
    "source-file"?: string;
    "status-code"?: number;
    "script-sample"?: string;
  };
}

/**
 * CSP Level 3 Reporting API format (sent as `application/reports+json`).
 * https://www.w3.org/TR/reporting/
 */
interface ReportingApiEntry {
  type: string;
  age?: number;
  url?: string;
  body?: {
    documentURL?: string;
    referrer?: string;
    violatedDirective?: string;
    effectiveDirective?: string;
    originalPolicy?: string;
    disposition?: string;
    blockedURL?: string;
    lineNumber?: number;
    columnNumber?: number;
    sourceFile?: string;
    statusCode?: number;
    sample?: string;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalise a report into a flat record regardless of whether it arrived via
 * the legacy `report-uri` format or the newer Reporting API format.
 */
function normaliseReport(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;

  // Legacy report-uri format: { "csp-report": { ... } }
  const legacy = raw as CspReportBody;
  if (legacy["csp-report"]) {
    const r = legacy["csp-report"];
    return {
      document_uri: r["document-uri"] ?? null,
      referrer: r.referrer ?? null,
      violated_directive: r["violated-directive"] ?? null,
      effective_directive: r["effective-directive"] ?? null,
      blocked_uri: r["blocked-uri"] ?? null,
      disposition: r.disposition ?? null,
      original_policy: r["original-policy"] ?? null,
      source_file: r["source-file"] ?? null,
      line_number: r["line-number"] ?? null,
      column_number: r["column-number"] ?? null,
      status_code: r["status-code"] ?? null,
      script_sample: r["script-sample"] ?? null,
    };
  }

  // Reporting API format: [{ type: "csp-violation", body: { ... } }, ...]
  const entries = Array.isArray(raw) ? (raw as ReportingApiEntry[]) : null;
  const entry = entries?.find((e) => e.type === "csp-violation");
  if (entry?.body) {
    const b = entry.body;
    return {
      document_uri: b.documentURL ?? entry.url ?? null,
      referrer: b.referrer ?? null,
      violated_directive: b.violatedDirective ?? null,
      effective_directive: b.effectiveDirective ?? null,
      blocked_uri: b.blockedURL ?? null,
      disposition: b.disposition ?? null,
      original_policy: b.originalPolicy ?? null,
      source_file: b.sourceFile ?? null,
      line_number: b.lineNumber ?? null,
      column_number: b.columnNumber ?? null,
      status_code: b.statusCode ?? null,
      script_sample: b.sample ?? null,
    };
  }

  return null;
}

/** Extract the best available client IP from Next.js request headers. */
function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Rate limiting ────────────────────────────────────────────────────────
  const ip = clientIp(req);
  if (!rateLimit(`csp-report:${ip}`, RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    return new NextResponse(null, { status: 429 });
  }

  // ── 2. Body size guard ──────────────────────────────────────────────────────
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  // ── 3. Parse body ───────────────────────────────────────────────────────────
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }
    raw = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // ── 4. Normalise report ─────────────────────────────────────────────────────
  const report = normaliseReport(raw);
  if (!report) {
    // Unrecognised format — silently accept (don't break browsers).
    return new NextResponse(null, { status: 204 });
  }

  // ── 5. Persist to database ──────────────────────────────────────────────────
  try {
    await pool.query(
      `INSERT INTO csp_violation_reports
         (document_uri, referrer, violated_directive, effective_directive,
          blocked_uri, disposition, original_policy, source_file,
          line_number, column_number, status_code, script_sample,
          reported_at, client_ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),$13)`,
      [
        report.document_uri,
        report.referrer,
        report.violated_directive,
        report.effective_directive,
        report.blocked_uri,
        report.disposition,
        report.original_policy,
        report.source_file,
        report.line_number,
        report.column_number,
        report.status_code,
        report.script_sample,
        ip,
      ]
    );
  } catch (dbErr) {
    // Log but don't fail — we still want to forward to Sentry even if DB is
    // unavailable, and browsers should not retry on 5xx.
    Sentry.captureException(dbErr, {
      tags: { component: "csp-report", phase: "db-insert" },
    });
  }

  // ── 6. Forward to Sentry ────────────────────────────────────────────────────
  Sentry.captureEvent({
    message: `CSP violation: ${String(report.effective_directive ?? report.violated_directive ?? "unknown")}`,
    level: "warning",
    tags: {
      component: "csp-report",
      violated_directive: String(report.violated_directive ?? ""),
      effective_directive: String(report.effective_directive ?? ""),
      disposition: String(report.disposition ?? "enforce"),
    },
    extra: report,
  });

  // Browsers expect 204 No Content for CSP report endpoints.
  return new NextResponse(null, { status: 204 });
}
