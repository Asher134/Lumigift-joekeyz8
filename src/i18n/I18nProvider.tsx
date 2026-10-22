"use client";

/**
 * I18nProvider — Issue #277
 *
 * Wraps the app with a React context that provides the active locale and
 * the `t()` translation function. Language preference is persisted to
 * localStorage under the key "lumigift_locale".
 *
 * The `<html lang>` attribute is updated imperatively via useEffect so that
 * screen readers and browser translation tools reflect the active language.
 */

import { createContext, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";

import type { Locale, TranslationKey } from "./types";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, type UseTranslationReturn } from "./index";

// ─── Locale bundles (static imports — no dynamic import needed) ───────────────

import en from "./locales/en.json";
import ha from "./locales/ha.json";
import yo from "./locales/yo.json";

const BUNDLES: Record<Locale, Record<string, Record<string, string>>> = { en, ha, yo };

// ─── Context ──────────────────────────────────────────────────────────────────

export const I18nContext = createContext<UseTranslationReturn | null>(null);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reads a dot-notation key from a nested object.
 * e.g. "nav.send_gift" → bundle.nav.send_gift
 */
function resolvePath(
  bundle: Record<string, Record<string, string>>,
  key: string
): string | undefined {
  const [ns, ...rest] = key.split(".");
  const section = bundle[ns];
  if (!section) return undefined;
  return section[rest.join(".")];
}

/**
 * Interpolates named placeholders into a template string.
 * e.g. "Page {page} · {total} gifts" + { page: 1, total: 5 } → "Page 1 · 5 gifts"
 */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    name in vars ? String(vars[name]) : `{${name}}`
  );
}

/**
 * Returns a safe locale code; falls back to DEFAULT_LOCALE if unknown.
 */
function sanitiseLocale(raw: string | null): Locale {
  if (raw === "en" || raw === "ha" || raw === "yo") return raw;
  return DEFAULT_LOCALE;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Hydrate from localStorage on mount (client-only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      const safe = sanitiseLocale(stored);
      if (safe !== locale) setLocaleState(safe);
    } catch {
      // localStorage unavailable — stay with default
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep <html lang> in sync
  useEffect(() => {
    try {
      document.documentElement.setAttribute("lang", locale);
    } catch {
      // SSR safety
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    const safe = sanitiseLocale(next);
    setLocaleState(safe);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, safe);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      const activeBundle = BUNDLES[locale];
      const enBundle = BUNDLES[DEFAULT_LOCALE];

      // Try active locale first, then fall back to English, then use the key.
      const raw = resolvePath(activeBundle, key) ?? resolvePath(enBundle, key) ?? key;

      return interpolate(raw, vars);
    },
    [locale]
  );

  const value = useMemo<UseTranslationReturn>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
