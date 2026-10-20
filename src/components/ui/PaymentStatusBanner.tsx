"use client";

/**
 * PaymentStatusBanner — issue #40
 *
 * Displays a provider-specific status message for a payment (Paystack or Stripe)
 * and surfaces safe, context-appropriate recovery actions.
 *
 * Design principles:
 * - Each provider's pending/failed/success states map to a concrete user action.
 * - Refresh never creates another payment intent (idempotent by construction:
 *   the caller passes a reference that already exists; no new session is started).
 * - No raw provider error codes are shown to the user.
 */

import { useCallback, useState } from "react";
import type { PaymentProvider, PaymentStatus } from "@/types";
import styles from "./PaymentStatusBanner.module.css";

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface PaymentStatusBannerProps {
  /** The payment provider that processed (or attempted) the payment. */
  provider: PaymentProvider;
  /** The current lifecycle status of the payment. */
  status: PaymentStatus;
  /**
   * Called when the user explicitly requests a status refresh.
   * The implementation should re-query the payment status without creating
   * a new payment intent (use the existing provider reference).
   */
  onRefresh?: () => void | Promise<void>;
  /**
   * Called when the user requests to retry a failed payment.
   * The implementation should reuse the same idempotency key / reference so
   * that the provider can deduplicate if the original payment actually succeeded.
   */
  onRetry?: () => void | Promise<void>;
  /**
   * Called when the user requests to contact support.
   * Provide a mailto: link or a route to the help page.
   */
  onContactSupport?: () => void;
  /** Override the default support contact URL (defaults to the help page). */
  supportUrl?: string;
}

/* ── Static content maps ──────────────────────────────────────────────────── */

type StatusContent = {
  /** Accessible short label for the banner (also used as aria-label). */
  heading: string;
  /** Human-readable explanation of the current state. */
  message: string;
  /** Visual variant for the banner border/icon. */
  variant: "info" | "warning" | "success" | "error";
  /** Emoji icon (aria-hidden) for quick visual scanning. */
  icon: string;
};

const PAYSTACK_CONTENT: Record<PaymentStatus, StatusContent> = {
  pending: {
    heading: "Payment pending",
    message:
      "Your Paystack payment is being processed. This usually takes less than a minute. " +
      "You can safely check the status — refreshing will not create a new charge.",
    variant: "warning",
    icon: "⏳",
  },
  success: {
    heading: "Payment successful",
    message:
      "Your Paystack payment was received. Your gift is being set up on the Stellar network.",
    variant: "success",
    icon: "✅",
  },
  failed: {
    heading: "Payment failed",
    message:
      "Your Paystack payment could not be completed. This may be due to insufficient funds, " +
      "a card decline, or a network issue. No charge has been made.",
    variant: "error",
    icon: "❌",
  },
  refunded: {
    heading: "Payment refunded",
    message:
      "Your Paystack payment has been refunded. Funds typically appear within 3–5 business days.",
    variant: "info",
    icon: "↩",
  },
};

const STRIPE_CONTENT: Record<PaymentStatus, StatusContent> = {
  pending: {
    heading: "Payment pending",
    message:
      "Your Stripe payment is awaiting confirmation. International card payments may take a " +
      "moment longer. You can safely check the status without starting a new payment.",
    variant: "warning",
    icon: "⏳",
  },
  success: {
    heading: "Payment successful",
    message: "Your Stripe payment was confirmed. Your gift is being set up on the Stellar network.",
    variant: "success",
    icon: "✅",
  },
  failed: {
    heading: "Payment failed",
    message:
      "Your Stripe payment was declined. This may be due to a card restriction, insufficient " +
      "funds, or a 3D Secure authentication issue. No charge has been made.",
    variant: "error",
    icon: "❌",
  },
  refunded: {
    heading: "Payment refunded",
    message:
      "Your Stripe payment has been refunded. Funds typically appear within 5–10 business days " +
      "depending on your bank.",
    variant: "info",
    icon: "↩",
  },
};

const PROVIDER_LABEL: Record<PaymentProvider, string> = {
  paystack: "Paystack",
  stripe: "Stripe",
};

/* ── Component ────────────────────────────────────────────────────────────── */

export function PaymentStatusBanner({
  provider,
  status,
  onRefresh,
  onRetry,
  onContactSupport,
  supportUrl = "/help",
}: PaymentStatusBannerProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const content = provider === "paystack" ? PAYSTACK_CONTENT[status] : STRIPE_CONTENT[status];

  const handleRefresh = useCallback(async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh, refreshing]);

  const handleRetry = useCallback(async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }, [onRetry, retrying]);

  const handleSupport = useCallback(() => {
    if (onContactSupport) {
      onContactSupport();
    } else {
      window.location.href = supportUrl;
    }
  }, [onContactSupport, supportUrl]);

  return (
    <div
      className={[styles.banner, styles[`banner--${content.variant}`]].join(" ")}
      role="status"
      aria-live="polite"
      aria-label={`${PROVIDER_LABEL[provider]}: ${content.heading}`}
    >
      <div className={styles.header}>
        <span aria-hidden="true" className={styles.icon}>
          {content.icon}
        </span>
        <span className={styles.heading}>{content.heading}</span>
        <span className={styles.providerBadge}>{PROVIDER_LABEL[provider]}</span>
      </div>

      <p className={styles.message}>{content.message}</p>

      {/* Recovery actions — shown conditionally based on status */}
      <div className={styles.actions}>
        {/* Refresh: shown for pending state so users can check without a full page reload */}
        {status === "pending" && onRefresh && (
          <button
            className={styles.actionBtn}
            onClick={handleRefresh}
            disabled={refreshing}
            aria-busy={refreshing}
          >
            {refreshing ? "Checking…" : "Check status"}
          </button>
        )}

        {/* Retry: shown for failed payments — reuses the existing payment reference */}
        {status === "failed" && onRetry && (
          <button
            className={[styles.actionBtn, styles["actionBtn--primary"]].join(" ")}
            onClick={handleRetry}
            disabled={retrying}
            aria-busy={retrying}
          >
            {retrying ? "Retrying…" : "Try again"}
          </button>
        )}

        {/* Support: shown for failed and refunded states */}
        {(status === "failed" || status === "refunded") && (
          <button className={styles.actionBtn} onClick={handleSupport}>
            Contact support
          </button>
        )}
      </div>
    </div>
  );
}
