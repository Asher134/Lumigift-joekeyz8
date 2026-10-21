"use client";

import { useForm } from "react-hook-form";
import { clsx } from "clsx";
import { zodResolver } from "@hookform/resolvers/zod";
import { createGiftSchema, GIFT_MESSAGE_MAX_LENGTH } from "@/types/schemas";
import type { CreateGiftInput } from "@/types/schemas";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { GiftPreview } from "./GiftPreview";
import { GiftPreviewCard } from "./GiftPreviewCard";
import { useState } from "react";
import { useCsrf } from "@/hooks/useCsrf";
import { formatNGN } from "@/lib/currency";
import { isAmbiguousDstTransition } from "@/lib/dateFormat";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GiftFlowErrorBoundary } from "./GiftFlowErrorBoundary";
import styles from "./CreateGiftForm.module.css";

type Step = "form" | "preview";

export function CreateGiftForm() {
  return (
    <GiftFlowErrorBoundary>
      <CreateGiftFormContent />
    </GiftFlowErrorBoundary>
  );
}

function CreateGiftFormContent() {
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [usdcEquivalent, setUsdcEquivalent] = useState("…");
  const [showUnregisteredWarning, setShowUnregisteredWarning] = useState(false);
  const [recipientRegistered, setRecipientRegistered] = useState<boolean | null>(null);
  const [unlockDstWarning, setUnlockDstWarning] = useState(false);

  const { csrfFetch } = useCsrf();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    getValues,
    watch,
    formState: { errors },
  } = useForm<CreateGiftInput>({
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
    },
  });

  // Step 1 → Step 2: fetch USDC estimate then show preview
  const onFormSubmit = async (data: CreateGiftInput) => {
    setLoading(true);
    setError(null);
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
  };

  const onConfirm = () => {
    setError(null);
    const data = getValues();
    createGiftMutation.mutate(data);
  };

  const messageLength = (watch("message") ?? "").length;
  const messageRemaining = GIFT_MESSAGE_MAX_LENGTH - messageLength;

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

        <Input
          label="Gift Amount (₦)"
          type="number"
          placeholder="5000"
          min={500}
          max={500000}
          error={errors.amountNgn?.message}
          {...register("amountNgn", { valueAsNumber: true })}
        />
        <p className="input-hint">
          Min {formatNGN(500)} · Max {formatNGN(500000)} · Daily limit {formatNGN(1000000)}
        </p>

        <Input
          label="Unlock Date & Time"
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
          maxLength={GIFT_MESSAGE_MAX_LENGTH}
          error={errors.message?.message}
          aria-describedby={clsx("message-counter", errors.message && "message-error")}
          {...register("message")}
        />
        <p
          id="message-counter"
          className={clsx(styles.counter, messageRemaining < 20 && styles.counterWarning)}
          aria-live="polite"
        >
          {messageLength}/{GIFT_MESSAGE_MAX_LENGTH}
        </p>

        <section aria-label="Gift card preview">
          <GiftPreviewCard data={watch()} onEdit={() => {}} />
        </section>

        <Button type="submit" fullWidth loading={loading}>
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
