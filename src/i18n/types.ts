/**
 * Type definitions for the lightweight i18n system — Issue #277
 */

import type enMessages from "./locales/en.json";

export type Locale = "en" | "ha" | "yo";

/**
 * Deep dot-notation paths for the en.json structure.
 * Provides autocomplete + type-safety for `t(key)` calls.
 */
type DotPaths<T, Prefix extends string = ""> = {
  [K in keyof T]: T[K] extends string
    ? Prefix extends ""
      ? `${string & K}`
      : `${Prefix}.${string & K}`
    : T[K] extends Record<string, unknown>
      ? Prefix extends ""
        ? DotPaths<T[K], `${string & K}`>
        : DotPaths<T[K], `${Prefix}.${string & K}`>
      : never;
}[keyof T];

export type TranslationKey = DotPaths<typeof enMessages>;

/** Flat (already-loaded) translations map */
export type Translations = Record<string, Record<string, string>>;
