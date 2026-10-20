"use client";

/**
 * /gifts/[id]/payment — Payment status view (issue #40)
 *
 * Displays the current payment state for a gift after a Paystack or Stripe
 * redirect. The page polls the payment status on mount and exposes safe
 * recovery actions (check status, retry, contact support) without ever
 * triggering a new payment intent.
 *
 * URL params:
 *   - provider:   "paystack" | "stripe"
 *   - reference:  Provider-specific transaction reference
 *   - status:     Optional override (e.g. "failed" set by the callback route)
 */

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PaymentStatusBanner } from "@/components/ui/PaymentStatusBanner";
import type { PaymentProvider, PaymentStatus } from "@/types";
import styles from "./page.module.css";

type PageStatus = "loading" | "loaded" | "error";

interface PaymentState {
  provider: PaymentProvider;
  status: PaymentStatus;
  reference: string;
}

async function fetchPaymentStatus(reference: string): Promise<PaymentStatus> {
  const res = await fetch(`/api/v1/payments?reference=${encodeURIComponent(reference)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Could not fetch payment status");
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "Unknown error");
  return json.data.status as PaymentStatus;
}

interface Props {
  params: { id: string };
}

export default function PaymentStatusPage({ params }: Props) {
  const { id: giftId } = params;
  const searchParams = useSearchParams();
  const router = useRouter();

  const providerParam = (searchParams.get("provider") ?? "paystack") as PaymentProvider;
  const referenceParam = searchParams.get("reference") ?? "";
  // Allow the callback route to pass an explicit status override
  const initialStatus = (searchParams.get("status") ?? null) as PaymentStatus | null;

  const [pageStatus, setPageStatus] = useState<PageStatus>(initialStatus ? "loaded" : "loading");
  const [payment, setPayment] = useState<PaymentState | null>(
    initialStatus
      ? {
          provider: providerParam,
          status: initialStatus,
          reference: referenceParam,
        }
      : null
  );
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!referenceParam) {
      setFetchError("No payment reference found. Please return to your dashboard.");
      setPageStatus("error");
      return;
    }

    setPageStatus("loading");
    setFetchError(null);

    try {
      const status = await fetchPaymentStatus(referenceParam);
      setPayment({
        provider: providerParam,
        status,
        reference: referenceParam,
      });
      setPageStatus("loaded");
    } catch {
      setFetchError("Could not retrieve payment status. Please try again.");
      setPageStatus("error");
    }
  }, [referenceParam, providerParam]);

  useEffect(() => {
    if (!initialStatus) {
      loadStatus();
    }
  }, [initialStatus, loadStatus]);

  const handleRefresh = useCallback(async () => {
    await loadStatus();
  }, [loadStatus]);

  const handleRetry = useCallback(() => {
    // Navigate back to the gift creation flow — the idempotency key is
    // preserved in the wizard's useRef so a retry will not create a duplicate.
    router.push(`/send?retry=${giftId}`);
  }, [router, giftId]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (pageStatus === "loading") {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <p className={styles.loadingMsg} aria-live="polite" aria-busy="true">
            Checking payment status…
          </p>
        </div>
      </main>
    );
  }

  // ── Fetch error ──────────────────────────────────────────────────────────
  if (pageStatus === "error" || !payment) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <p className={styles.errorMsg} role="alert">
            {fetchError ?? "An unexpected error occurred."}
          </p>
          <button className="btn btn--secondary" onClick={loadStatus}>
            Try again
          </button>
          <Link href="/dashboard" className={styles.dashLink}>
            Go to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const { provider, status } = payment;

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Payment Status</h1>

        <PaymentStatusBanner
          provider={provider}
          status={status}
          onRefresh={status === "pending" ? handleRefresh : undefined}
          onRetry={status === "failed" ? handleRetry : undefined}
          supportUrl="/help"
        />

        {/* Successful payments navigate to the gift view */}
        {status === "success" && (
          <div className={styles.successActions}>
            <Link href={`/gifts/${giftId}`} className="btn btn--primary">
              View your gift
            </Link>
            <Link href="/dashboard" className="btn btn--secondary">
              Go to dashboard
            </Link>
          </div>
        )}

        {status !== "success" && (
          <Link href="/dashboard" className={styles.dashLink}>
            ← Back to dashboard
          </Link>
        )}
      </div>
    </main>
  );
}
