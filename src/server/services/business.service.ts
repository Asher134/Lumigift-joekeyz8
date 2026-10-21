/**
 * Business / corporate gifting service — issue #345
 *
 * Business accounts upload a CSV of recipients, pay for every gift with a
 * single Paystack charge, and can download a PDF invoice for accounting.
 */
import { randomUUID } from "crypto";
import pool from "@/lib/db";
import { initializePayment, ngnToKobo } from "@/lib/paystack";
import { serverConfig } from "@/server/config";
import { AppError, ERROR_CODES } from "@/server/errors";
import { createGiftSchema } from "@/types/schemas";

export const MAX_BULK_RECIPIENTS = 500;

const REQUIRED_COLUMNS = ["recipientName", "recipientPhone", "amountNgn", "unlockAt"] as const;

export interface BulkGiftItem {
  recipientName: string;
  recipientPhone: string;
  amountNgn: number;
  unlockAt: string;
  message?: string;
}

export interface BulkGiftOrder {
  id: string;
  userId: string;
  paymentReference: string;
  totalNgn: number;
  items: BulkGiftItem[];
  status: string;
  createdAt: Date;
}

export interface CsvRowError {
  row: number;
  error: string;
}

/** Splits one CSV line, honouring double-quoted fields and `""` escapes. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parses and validates a recipients CSV. The header row must contain
 * `recipientName,recipientPhone,amountNgn,unlockAt` and optionally `message`.
 */
export function parseRecipientsCsv(csv: string): { items: BulkGiftItem[]; errors: CsvRowError[] } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "CSV must contain a header and at least one row",
      400
    );
  }
  if (lines.length - 1 > MAX_BULK_RECIPIENTS) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `CSV cannot contain more than ${MAX_BULK_RECIPIENTS} recipients`,
      400
    );
  }

  const header = parseCsvLine(lines[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `CSV is missing columns: ${missing.join(", ")}`,
      400
    );
  }

  const items: BulkGiftItem[] = [];
  const errors: CsvRowError[] = [];

  lines.slice(1).forEach((line, idx) => {
    const values = parseCsvLine(line);
    const raw = Object.fromEntries(header.map((h, i) => [h, values[i] ?? ""]));
    const parsed = createGiftSchema.safeParse({
      recipientName: raw.recipientName,
      recipientPhone: raw.recipientPhone,
      amountNgn: Number(raw.amountNgn),
      unlockAt: raw.unlockAt,
      message: raw.message || undefined,
      paymentProvider: "paystack",
    });
    if (!parsed.success) {
      errors.push({ row: idx + 2, error: parsed.error.issues[0]?.message ?? "Invalid row" });
      return;
    }
    const { recipientName, recipientPhone, amountNgn, unlockAt, message } = parsed.data;
    items.push({ recipientName, recipientPhone, amountNgn, unlockAt, message });
  });

  return { items, errors };
}

/** Throws 403 unless the user has a business account. */
export async function assertBusinessAccount(userId: string): Promise<void> {
  const { rows } = await pool.query<{ account_type: string }>(
    "SELECT account_type FROM users WHERE id = $1",
    [userId]
  );
  if (rows[0]?.account_type !== "business") {
    throw new AppError(ERROR_CODES.FORBIDDEN, "A business account is required", 403);
  }
}

/** Persists the order and initialises a single Paystack charge covering every recipient. */
export async function createBulkGiftOrder(
  userId: string,
  items: BulkGiftItem[]
): Promise<{ order: BulkGiftOrder; paymentUrl: string }> {
  const id = randomUUID();
  const paymentReference = `lumigift_bulk_${id}`;
  const totalNgn = items.reduce((sum, i) => sum + i.amountNgn, 0);

  const { rows } = await pool.query<{ created_at: Date }>(
    "INSERT INTO bulk_gift_orders (id, user_id, payment_reference, total_ngn, items) VALUES ($1, $2, $3, $4, $5) RETURNING created_at",
    [id, userId, paymentReference, totalNgn, JSON.stringify(items)]
  );

  const payment = await initializePayment({
    email: `${userId}@lumigift.app`, // placeholder; use real email from user record
    amountKobo: ngnToKobo(totalNgn),
    reference: paymentReference,
    callbackUrl: `${serverConfig.app.url}/api/payments/callback?bulkOrderId=${id}`,
    metadata: { bulkOrderId: id, senderId: userId, recipientCount: items.length },
  });

  return {
    order: {
      id,
      userId,
      paymentReference,
      totalNgn,
      items,
      status: "pending_payment",
      createdAt: rows[0].created_at,
    },
    paymentUrl: payment.authorizationUrl,
  };
}

export async function getBulkGiftOrder(userId: string, id: string): Promise<BulkGiftOrder | null> {
  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    payment_reference: string;
    total_ngn: string;
    items: BulkGiftItem[];
    status: string;
    created_at: Date;
  }>("SELECT * FROM bulk_gift_orders WHERE id = $1 AND user_id = $2", [id, userId]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    paymentReference: row.payment_reference,
    totalNgn: Number(row.total_ngn),
    items: row.items,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Dedicated account manager contact shown to business accounts. */
export function getAccountManagerContact() {
  return {
    name: process.env.BUSINESS_ACCOUNT_MANAGER_NAME ?? "Lumigift Business Team",
    email: process.env.BUSINESS_ACCOUNT_MANAGER_EMAIL ?? "business@lumigift.app",
    phone: process.env.BUSINESS_ACCOUNT_MANAGER_PHONE ?? null,
  };
}

function escapePdfText(text: string): string {
  // Standard PDF fonts only cover Latin-1; replace anything else (e.g. ₦).
  return text
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Builds a minimal single-page PDF invoice (monospace Courier, no external dependency). */
export function generateInvoicePdf(order: BulkGiftOrder): Buffer {
  const fmt = (n: number) => `NGN ${n.toLocaleString("en-NG")}`;
  const lines = [
    `${serverConfig.app.name} - Invoice`,
    "",
    `Invoice #: ${order.id}`,
    `Payment reference: ${order.paymentReference}`,
    `Date: ${order.createdAt.toISOString().slice(0, 10)}`,
    `Status: ${order.status}`,
    "",
    "Recipient                         Unlock date     Amount",
    ...order.items
      .slice(0, 40)
      .map(
        (i) =>
          `${i.recipientName.slice(0, 32).padEnd(34)}${i.unlockAt.slice(0, 10).padEnd(16)}${fmt(i.amountNgn)}`
      ),
    ...(order.items.length > 40 ? [`... and ${order.items.length - 40} more recipients`] : []),
    "",
    `Recipients: ${order.items.length}`,
    `Total: ${fmt(order.totalNgn)}`,
  ];

  const content = [
    "BT",
    "/F1 10 Tf",
    "12 TL",
    "50 800 Td",
    ...lines.map((l) => `(${escapePdfText(l)}) '`),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}
