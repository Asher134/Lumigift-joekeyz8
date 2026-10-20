"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { GiftStatusBadge } from "@/components/ui/GiftStatusBadge";
import { useCsrf } from "@/hooks/useCsrf";
import { formatNGN } from "@/lib/currency";
import { formatUnlockDate } from "@/lib/dateFormat";
import type { DiscoveredGift } from "@/server/services/claim-discovery.service";
import styles from "./page.module.css";

type Step = "phone" | "otp" | "results";

/**
 * Recipient claim discovery (Issue #148).
 *
 * The recipient proves control of their phone with an OTP before any gift is
 * shown. The copy never states whether a gift exists before verification.
 */
export default function ClaimDiscoveryPage() {
  const { csrfFetch } = useCsrf();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [gifts, setGifts] = useState<DiscoveredGift[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await csrfFetch("/api/v1/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Could not send a code");
      setStep("otp");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await csrfFetch("/api/v1/gifts/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Verification failed");
      setGifts(json.data.gifts);
      setStep("results");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className="container">
        <h1 className={styles.title}>Find your gift</h1>

        {step === "phone" && (
          <form className={styles.form} onSubmit={requestCode}>
            <p className={styles.subtitle}>
              Enter the phone number the sender used. We&apos;ll text you a code to confirm
              it&apos;s you.
            </p>
            <Input
              label="Phone number"
              id="claim-phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <Button type="submit" loading={loading} disabled={loading}>
              Send code
            </Button>
          </form>
        )}

        {step === "otp" && (
          <form className={styles.form} onSubmit={verify}>
            <p className={styles.subtitle}>
              If this number can receive codes, one is on its way. Enter it below.
            </p>
            <Input
              label="6-digit code"
              id="claim-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
            />
            <Button type="submit" loading={loading} disabled={loading}>
              Verify
            </Button>
            <button type="button" className="btn btn--ghost" onClick={() => setStep("phone")}>
              Use a different number
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}

        {step === "results" &&
          (gifts.length === 0 ? (
            <p role="status" className={styles.subtitle}>
              There are no gifts ready for this number right now. If someone told you they sent one,
              check the number with them — gifts appear here once the sender&apos;s payment is
              confirmed.
            </p>
          ) : (
            <ul className={styles.list} aria-label="Gifts for you">
              {gifts.map((g) => (
                <li key={g.id} className={styles.item}>
                  <div>
                    <strong>A gift for {g.recipientName}</strong>
                    <div className={styles.meta}>
                      {g.status === "unlocked"
                        ? `Unlocked ${formatUnlockDate(g.unlockAt)}`
                        : `Unlocks ${formatUnlockDate(g.unlockAt)}`}
                      {g.amountNgn !== undefined && ` · ${formatNGN(g.amountNgn)}`}
                    </div>
                  </div>
                  <GiftStatusBadge status={g.status} />
                  <Link href={`/gifts/${g.id}`} className="btn btn--primary">
                    {g.status === "unlocked" ? "Claim" : "View"}
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </main>
  );
}
