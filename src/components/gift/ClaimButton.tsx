"use client";

/**
 * ClaimButton — updated for issue #41
 *
 * States surfaced:
 *  - idle     : "Claim Gift" button visible
 *  - claiming : spinner + "Claiming…" text; button disabled
 *  - success  : transaction hash + Stellar explorer link; no further claiming possible
 *  - error    : user-friendly error message with retry guidance;
 *               prevents duplicate claims by checking for AlreadyClaimed errors
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCsrf } from "@/hooks/useCsrf";
import type { GiftStatus } from "@/types";
import styles from "./ClaimButton.module.css";

const STELLAR_EXPLORER_BASE = "https://stellar.expert/explorer/testnet/tx";

function explorerUrl(txHash: string): string {
  return `${STELLAR_EXPLORER_BASE}/${txHash}`;
}

interface ClaimButtonProps {
  giftId: string;
  recipientStellarKey: string;
  onStatusChange: (status: GiftStatus) => void;
}

/** Maps known API error messages to friendly guidance. */
function mapClaimError(rawMessage: string): { message: string; canRetry: boolean } {
  const lower = rawMessage.toLowerCase();

  if (lower.includes("already claimed") || lower.includes("alreadyclaimed")) {
    return {
      message:
        "This gift has already been claimed. If you believe this is a mistake, please contact support.",
      canRetry: false,
    };
  }

  if (lower.includes("not yet unlocked") || lower.includes("unlock")) {
    return {
      message: "This gift is not yet unlocked. Please come back after the unlock time.",
      canRetry: false,
    };
  }

  if (lower.includes("trustline") || lower.includes("no trustline")) {
    return {
      message:
        "Your Stellar wallet does not have a USDC trustline. " +
        "Please add a USDC trustline in your wallet app and try again.",
      canRetry: true,
    };
  }

  if (lower.includes("network") || lower.includes("horizon") || lower.includes("rpc")) {
    return {
      message:
        "The Stellar network is temporarily unavailable. " +
        "Please wait a moment and try again — your claim has not been submitted yet.",
      canRetry: true,
    };
  }

  return {
    message: "Something went wrong while claiming your gift. Please try again.",
    canRetry: true,
  };
}

export function ClaimButton({ giftId, recipientStellarKey, onStatusChange }: ClaimButtonProps) {
  const [claimError, setClaimError] = useState<{ message: string; canRetry: boolean } | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const { csrfFetch } = useCsrf();
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const res = await csrfFetch(`/api/v1/gifts/${giftId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ giftId, recipientStellarKey }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Claim failed");
      // Return the transaction hash from the API response
      return json.data as { txHash?: string };
    },
    onMutate: () => {
      setClaimError(null);
      setTxHash(null);
      onStatusChange("claiming" as GiftStatus);
    },
    onSuccess: (data) => {
      if (data?.txHash) {
        setTxHash(data.txHash);
      }
      onStatusChange("claimed");
      // Invalidate gift list so the dashboard reflects the claimed status
      queryClient.invalidateQueries({ queryKey: ["gifts"] });
    },
    onError: (err: Error) => {
      // Revert the optimistic status update on failure
      onStatusChange("unlocked");
      setClaimError(mapClaimError(err.message));
    },
  });

  // ── Success state ──────────────────────────────────────────────────────────
  if (txHash) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.successBanner} role="status" aria-live="polite">
          <span aria-hidden="true" className={styles.successIcon}>
            ✅
          </span>
          <div className={styles.successContent}>
            <p className={styles.successMsg}>Gift claimed successfully!</p>
            <p className={styles.txLabel}>Transaction confirmed on the Stellar network.</p>
            <div className={styles.txRow}>
              <code className={styles.txHash} title={txHash}>
                {txHash.slice(0, 8)}…{txHash.slice(-8)}
              </code>
              <a
                href={explorerUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.explorerLink}
                aria-label={`View transaction ${txHash.slice(0, 8)}… on Stellar Expert`}
              >
                View on Stellar Expert ↗
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Default / error state ─────────────────────────────────────────────────
  return (
    <div className={styles.wrapper}>
      <button
        className="btn btn--primary"
        onClick={() => mutate()}
        disabled={isPending || (claimError !== null && !claimError.canRetry)}
        aria-busy={isPending}
      >
        {isPending ? <span className={styles.spinner} aria-hidden="true" /> : null}
        {isPending ? "Claiming…" : "Claim Gift"}
      </button>

      {claimError && (
        <div role="alert" className={styles.errorBlock}>
          <p className={styles.error}>{claimError.message}</p>
          {claimError.canRetry && (
            <p className={styles.retryHint}>
              Press &ldquo;Claim Gift&rdquo; to try again. Your funds have not been moved.
            </p>
          )}
          {!claimError.canRetry && (
            <p className={styles.retryHint}>
              If you need further help,{" "}
              <a href="/help" className={styles.supportLink}>
                contact support
              </a>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}
