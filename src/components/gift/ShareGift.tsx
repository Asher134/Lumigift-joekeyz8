"use client";

import { useToast } from "@/components/ui/ToastContext";
import { Button } from "@/components/ui/Button";
import styles from "./ShareGift.module.css";

interface ShareGiftProps {
  giftId: string;
  recipientName: string;
}

/**
 * Builds the gift claim URL from the gift ID only — no PII is included.
 */
function buildClaimUrl(giftId: string): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? "");
  return `${base}/gifts/${giftId}`;
}

function buildShareText(recipientName: string, claimUrl: string): string {
  return `🎁 You have a surprise gift waiting, ${recipientName}! Claim it here: ${claimUrl}`;
}

/**
 * ShareGift — renders sharing options for a created gift.
 *
 * Priority order:
 *   1. Web Share API (native sheet on mobile — iOS Safari, Android Chrome)
 *   2. Clipboard copy with a success toast (desktop fallback)
 *
 * The shared URL contains only the gift ID — no PII.
 */
export function ShareGift({ giftId, recipientName }: ShareGiftProps) {
  const { addToast } = useToast();

  const claimUrl = buildClaimUrl(giftId);
  const text = buildShareText(recipientName, claimUrl);

  const handleShare = async () => {
    // ── Primary: Web Share API (mobile native sheet) ─────────────────────────
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Lumigift", text, url: claimUrl });
        // User completed the share — no toast needed (native sheet is the feedback)
        return;
      } catch (err) {
        // AbortError = user dismissed the sheet; fall through to clipboard.
        // Any other error also falls through.
        if (err instanceof Error && err.name !== "AbortError") {
          console.warn("[ShareGift] navigator.share failed:", err);
        }
      }
    }

    // ── Fallback: clipboard copy ──────────────────────────────────────────────
    try {
      await navigator.clipboard.writeText(claimUrl);
      addToast("Gift link copied to clipboard!", "success");
    } catch {
      // Clipboard API unavailable (e.g. non-secure context in older browsers)
      addToast("Could not copy link. Please copy it manually.", "error");
    }
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const smsUrl = `sms:?body=${encodeURIComponent(text)}`;

  return (
    <div className={styles.container}>
      <Button variant="secondary" size="sm" onClick={handleShare} aria-label="Share gift link">
        Share
      </Button>

      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.link}
        aria-label="Share on WhatsApp"
      >
        WhatsApp
      </a>

      <a href={smsUrl} className={styles.link} aria-label="Share via SMS">
        SMS
      </a>
    </div>
  );
}
