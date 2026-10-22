"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useCsrf } from "@/hooks/useCsrf";

export function FulfilWishButton({ slug }: { slug: string }) {
  const [error, setError] = useState<string | null>(null);
  const { csrfFetch } = useCsrf();

  const { mutate, isPending } = useMutation({
    mutationFn: async (): Promise<string> => {
      const res = await csrfFetch(`/api/v1/wishlists/${slug}/fulfil`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentProvider: "paystack" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Could not fulfil this wish");
      return json.data.paymentUrl;
    },
    onMutate: () => setError(null),
    onSuccess: (paymentUrl) => {
      window.location.href = paymentUrl;
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <>
      <button
        type="button"
        className="btn btn--primary"
        disabled={isPending}
        onClick={() => mutate()}
      >
        {isPending ? "Starting…" : "Fulfil this wish"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
