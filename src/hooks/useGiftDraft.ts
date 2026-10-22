/**
 * useGiftDraft — persists non-sensitive draft fields to localStorage
 * so the gift wizard can recover its state after an accidental page refresh
 * and so draft state stays in sync across open browser tabs.
 *
 * Security rules (issue #33):
 *   - Payment secrets and OTPs are NEVER stored.
 *   - Raw recipient phone numbers are NEVER stored (only name, email, message,
 *     amount, unlock date, and the current wizard step).
 *   - localStorage is shared across tabs of the same origin, so a `storage`
 *     event listener keeps every open tab's draft in sync.
 *
 * The hook returns `{ draft, readDraft, saveDraft, clearDraft }`. `draft` is
 * reactive: it updates whenever localStorage changes (e.g. from another tab).
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "lumigift_gift_draft_v1";

/**
 * Only safe, non-sensitive fields are persisted.
 * Phone, OTP, and payment details are deliberately excluded.
 */
export interface GiftDraft {
  /** Current wizard step (0-indexed) */
  step: number;
  recipientName?: string;
  /** Optional email — kept only if the user explicitly typed it */
  recipientEmail?: string;
  amountNgn?: number;
  message?: string;
  unlockAt?: string;
  templateId?: string;
}

function safeParse(raw: string | null): GiftDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Basic shape guard — must have a numeric step
    if (typeof parsed?.step !== "number") return null;
    return parsed as GiftDraft;
  } catch {
    return null;
  }
}

/** Deep-equality check for drafts so we do not re-render on no-op storage events. */
function draftEqual(a: GiftDraft | null, b: GiftDraft | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useGiftDraft() {
  const [draft, setDraft] = useState<GiftDraft | null>(null);

  // Initialise from localStorage on mount so a refresh restores the draft.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setDraft(safeParse(localStorage.getItem(STORAGE_KEY)));
  }, []);

  // Sync draft state across tabs: when another tab writes to localStorage the
  // `storage` event fires here, and we adopt the new value.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = safeParse(e.newValue);
      // Only re-render when the value actually changed — prevents loops.
      if (!draftEqual(draft, next)) {
        setDraft(next);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [draft]);

  const readDraft = useCallback((): GiftDraft | null => draft, [draft]);

  const saveDraft = useCallback((nextDraft: GiftDraft) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextDraft));
      setDraft(nextDraft);
    } catch {
      // Quota exceeded or private-browsing restriction — fail silently
    }
  }, []);

  const clearDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
    setDraft(null);
  }, []);

  return { draft, readDraft, saveDraft, clearDraft };
}
