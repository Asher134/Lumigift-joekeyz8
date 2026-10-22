"use client";

/**
 * Lightweight i18n — Issue #277
 *
 * No external dependencies. Uses React context + localStorage for persistence.
 * All 3 supported locales are LTR; no RTL handling is needed.
 *
 * Usage:
 *   const { t, locale, setLocale } = useTranslation();
 *   t("nav.send_gift")          // "Send a Gift"
 *   t("dashboard.page_count", { page: 1, total: 5 }) // "Page 1 · 5 gifts total"
 */

import { useContext } from "react";
import { I18nContext } from "./I18nProvider";
import type { Locale, TranslationKey, Translations } from "./types";

export type { Locale, Translations };

// ─── Re-export for convenience ────────────────────────────────────────────────

export { I18nContext };

// ─── useTranslation hook ──────────────────────────────────────────────────────

export interface UseTranslationReturn {
  /** The active locale code, e.g. "en" | "ha" | "yo" */
  locale: Locale;
  /** Change the active locale and persist it to localStorage */
  setLocale: (locale: Locale) => void;
  /**
   * Look up a translation key and interpolate named placeholders.
   *
   * @param key  - Dot-notation key, e.g. "nav.send_gift"
   * @param vars - Optional map of {placeholder: value} for interpolation
   *
   * Falls back to the English value if the key is missing in the active locale.
   * Returns the key itself if not found in any locale (so nothing silently disappears).
   */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

export function useTranslation(): UseTranslationReturn {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useTranslation must be used inside <I18nProvider>");
  }
  return ctx;
}

// ─── Supported locales list (exported for the language selector) ──────────────

export const SUPPORTED_LOCALES: Array<{ code: Locale; label: string; nativeLabel: string }> = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "ha", label: "Hausa", nativeLabel: "Hausa" },
  { code: "yo", label: "Yoruba", nativeLabel: "Yorùbá" },
];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "lumigift_locale";
