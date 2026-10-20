"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCsrf } from "@/hooks/useCsrf";
import { Dialog } from "@/components/ui/Dialog";
import type { Gift, RefundStatus } from "@/types";
import type { CancellationEligibility } from "@/server/services/cancellation.service";
import styles from "./CancelGiftButton.module.css";

interface CancelGiftButtonProps {
  giftId: string;
  onCancelled: (_gift: Gift) => void;
}

async function fetchEligibility(giftId: string): Promise<CancellationEligibility> {
  const res = await fetch(`/api/v1/gifts/${giftId}/cancel`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "Could not check cancellation eligibility");
  return json.data;
}

export function CancelGiftButton({ giftId, onCancelled }: CancelGiftButtonProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { csrfFetch } = useCsrf();
  const queryClient = useQueryClient();

  const eligibility = useQuery({
    queryKey: ["gifts", giftId, "cancel-eligibility"],
    queryFn: () => fetchEligibility(giftId),
    enabled: open,
  });

  const { mutate, isPending } = useMutation({
    mutationFn: async (): Promise<Gift> => {
      const res = await csrfFetch(`/api/v1/gifts/${giftId}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Cancellation failed");
      return json.data;
    },
    onMutate: () => setError(null),
    onSuccess: (gift) => {
      setOpen(false);
      onCancelled(gift);
      queryClient.invalidateQueries({ queryKey: ["gifts"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const data = eligibility.data;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--secondary"
        onClick={() => setOpen(true)}
      >
        Cancel gift
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        title="Cancel this gift?"
      >
        {eligibility.isPending && <p aria-live="polite">Checking eligibility…</p>}
        {eligibility.isError && (
          <p role="alert" className={styles.error}>
            {(eligibility.error as Error).message}
          </p>
        )}

        {data && !data.eligible && (
          <p role="alert" className={styles.error}>
            {data.reason}
          </p>
        )}

        {data?.eligible && (
          <ul className={styles.consequences}>
            {data.consequences.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}

        <p className={styles.support}>
          Questions? <a href={data?.supportUrl ?? "/help#cancellation-policy"}>Contact support</a>
        </p>

        <div className={styles.actions}>
          <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)}>
            Keep gift
          </button>
          {data?.eligible && (
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => mutate()}
              disabled={isPending}
              aria-busy={isPending}
            >
              {isPending ? "Cancelling…" : "Yes, cancel gift"}
            </button>
          )}
        </div>
      </Dialog>
    </>
  );
}

const REFUND_LABELS: Record<RefundStatus, string> = {
  not_required: "No refund needed — no payment was taken.",
  pending: "Refund in progress. It usually settles within 3–5 business days.",
  processed: "Refund completed to your original payment method.",
  failed: "Refund needs attention. Our support team has been notified.",
};

/** Shows refund progress and a support path for a cancelled gift. */
export function RefundStatusNotice({ status }: { status: RefundStatus }) {
  return (
    <p className={styles.refund} role="status" data-refund-status={status}>
      {REFUND_LABELS[status]}{" "}
      {status !== "not_required" && <a href="/help#cancellation-policy">Get help with a refund</a>}
    </p>
  );
}
