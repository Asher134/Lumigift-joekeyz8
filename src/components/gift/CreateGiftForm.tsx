"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createGiftSchema } from "@/types/schemas";
import type { CreateGiftInput } from "@/types/schemas";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import {
  ApiErrorBanner,
  classifyApiError,
  type ApiErrorState,
} from "@/components/ui/ApiErrorBanner";
import { GiftPreview } from "./GiftPreview";
import { useState, useRef } from "react";
import { useCsrf } from "@/hooks/useCsrf";
import { formatNGN } from "@/lib/currency";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import styles from "./CreateGiftForm.module.css";

// ── Gift amount limits (mirrors env defaults & Zod schema — issue #270) ───────
const GIFT_MIN_AMOUNT_NGN = 500;
const GIFT_MAX_AMOUNT_NGN = 5_000_000;
const GIFT_DAILY_LIMIT_NGN = 1_000_000;

type Step = "form" | "preview";

/**
 * Returns true when the supplied datetime-local string falls within a
 * known DST transition gap (heuristic: offset changes within ±2 hours).
 */
function isAmbiguousDstTransition(isoString: string): boolean {
  try {
    const date = new Date(isoString);
    const before = new Date(date.getTime() - 60 * 60 * 1000);
    const after = new Date(date.getTime() + 60 * 60 * 1000);
    const offsetBefore = before.getTimezoneOffset();
    const offsetAfter = after.getTimezoneOffset();
    return offsetBefore !== offsetAfter;
  } catch {
    return false;
  }
}

export function CreateGiftForm() {
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiErrorState | null>(null);
  const [loading, setLoading] = useState(false);
  const [usdcEquivalent, setUsdcEquivalent] = useState("…");
  const [showUnregisteredWarning, setShowUnregisteredWarning] = useState(false);
  const [recipientRegistered, setRecipientRegistered] = useState<boolean | null>(null);
  const [unlockDstWarning, setUnlockDstWarning] = useState(false);

  // Ref to the submit button that triggers the unregistered-recipient dialog;
  // focus returns here when the dialog closes.
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  const { csrfFetch } = useCsrf();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<CreateGiftInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(createGiftSchema) as any,
    defaultValues: { paymentProvider: "paystack", recipientIsRegistered: true },
    mode: "onBlur",
  });

  // useMutation for gift creation — invalidates the gifts cache on success so
  // the dashboard reflects the new gift without a manual reload.
  const createGiftMutation = useMutation({
    mutationFn: async (data: CreateGiftInput) => {
      const res = await csrfFetch("/api/v1/gifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          recipientIsRegistered: recipientRegistered ?? true,
        }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to create gift");
      }
      return res.json();
    },
    onSuccess: (json) => {
      // Invalidate all pages of the gifts list so the dashboard is up-to-date.
      queryClient.invalidateQueries({ queryKey: ["gifts"] });
      window.location.href = json.data.paymentUrl;
    },
    onError: (err: Error) => {
      setError(err.message);
      setApiError(classifyApiError(err.message));
    },
  });

  // Step 1 → Step 2: fetch USDC estimate then show preview
  const onFormSubmit = async (data: CreateGiftInput) => {
    setLoading(true);
    setError(null);
    setApiError(null);
    // Warn if the chosen local time falls in a DST gap
    setUnlockDstWarning(isAmbiguousDstTransition(data.unlockAt));
    try {
      // Check if recipient is registered (GET — no CSRF needed)
      const checkRes = await fetch(
        `/api/v1/users?phone=${encodeURIComponent(data.recipientPhone)}`
      );
      if (checkRes.ok) {
        const checkJson = await checkRes.json();
        setRecipientRegistered(checkJson.data?.exists ?? false);
        if (!checkJson.data?.exists) {
          setShowUnregisteredWarning(true);
          setLoading(false);
          return; // Don't proceed to preview yet
        }
      } else {
        // If check fails, assume registered to not block the happy path
        setRecipientRegistered(true);
      }

      // GET — no CSRF needed
      const res = await fetch(`/api/v1/exchange-rate?ngn=${data.amountNgn}`);
      if (res.ok) {
        const json = await res.json();
        setUsdcEquivalent(json.data?.usdc ?? "—");
      }
    } catch {
      // Exchange-rate is non-critical — preview still shows without USDC estimate
    }
    setStep("preview");
    setLoading(false);
  };

  const onProceedUnregistered = async () => {
    setShowUnregisteredWarning(false);
    try {
      const data = getValues();
      const res = await fetch(`/api/v1/exchange-rate?ngn=${data.amountNgn}`);
      if (res.ok) {
        const json = await res.json();
        setUsdcEquivalent(json.data?.usdc ?? "—");
      }
    } catch {
      // non-critical
    }
    setStep("preview");
  };

  const onCancelUnregistered = () => {
    setShowUnregisteredWarning(false);
    // Return focus to the submit button for keyboard users
    submitButtonRef.current?.focus();
  };

  const onConfirm = () => {
    setError(null);
    setApiError(null);
    const data = getValues();
    createGiftMutation.mutate(data);
  };

  const handleRetry = () => {
    setApiError(null);
    onConfirm();
  };

  if (step === "preview") {
    return (
      <GiftPreview
        data={getValues()}
        usdcEquivalent={usdcEquivalent}
        onEdit={() => setStep("form")}
        onConfirm={onConfirm}
        loading={createGiftMutation.isPending}
        error={error}
      />
    );
  }

  return (
    <>
      <form
        className={styles.form}
        onSubmit={handleSubmit(onFormSubmit as Parameters<typeof handleSubmit>[0])}
        noValidate
      >
        <h2 className={styles.title}>Send a Gift</h2>

        <Input
          label="Recipient's Name"
          placeholder="e.g. Amara"
          error={errors.recipientName?.message}
          {...register("recipientName")}
        />

        <Input
          label="Recipient's Phone"
          type="tel"
          placeholder="+2348012345678"
          error={errors.recipientPhone?.message}
          {...register("recipientPhone")}
        />

        {/* Amount field — limits enforced in Zod schema and mirrored here (#270) */}
        <Input
          label="Gift Amount (₦)"
          type="number"
          placeholder="5000"
          min={GIFT_MIN_AMOUNT_NGN}
          max={GIFT_MAX_AMOUNT_NGN}
          error={errors.amountNgn?.message}
          {...register("amountNgn", { valueAsNumber: true })}
        />
        <p className="input-hint">
          Min {formatNGN(GIFT_MIN_AMOUNT_NGN)} · Max {formatNGN(GIFT_MAX_AMOUNT_NGN)} · Daily limit{" "}
          {formatNGN(GIFT_DAILY_LIMIT_NGN)}
        </p>

        <Input
          label="Unlock Date &amp; Time"
          type="datetime-local"
          error={errors.unlockAt?.message}
          {...register("unlockAt")}
        />
        {unlockDstWarning && (
          <p role="alert" className={styles.dstWarning}>
            ⚠️ The selected time may be ambiguous due to a daylight-saving transition in your
            timezone. Please double-check the unlock time.
          </p>
        )}

        <Textarea
          label="Personal Message (optional)"
          id="message"
          rows={3}
          placeholder="Write something heartfelt…"
          error={errors.message?.message}
          {...register("message")}
        />

        {apiError && <ApiErrorBanner error={apiError} onRetry={handleRetry} />}

        <Button ref={submitButtonRef} type="submit" fullWidth loading={loading}>
          Preview Gift →
        </Button>
      </form>

      {showUnregisteredWarning && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3>Unregistered Recipient</h3>
            <p>
              The recipient&apos;s phone number is not registered with Lumigift. They will receive
              an SMS invitation to claim the gift, but must register first.
            </p>
            <p>Are you sure you want to proceed?</p>
            <div className={styles.modalActions}>
              <Button onClick={onCancelUnregistered} variant="secondary">
                Cancel
              </Button>
              <Button onClick={onProceedUnregistered}>Proceed</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
