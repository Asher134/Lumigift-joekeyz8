"use client";

/**
 * PhoneInput — E.164-normalising phone number input (issue #271)
 *
 * Features:
 *  - Live E.164 normalisation via src/lib/phone.ts
 *  - Human-readable formatted preview below the input
 *  - Validation error displayed for unrecognisable numbers
 *  - Defaults to Nigerian (+234); international toggle enables full E.164 input
 */

import { useState, forwardRef, useCallback } from "react";
import type { ChangeEvent, FocusEvent } from "react";
import { normalizePhone } from "@/lib/phone";
import styles from "./PhoneInput.module.css";

// ── Human-readable formatter ──────────────────────────────────────────────────

/**
 * Formats an E.164 string as a human-readable phone number.
 *
 * Examples:
 *   +2348012345678  → "+234 801 234 5678"
 *   +14155552671    → "+1 415 555 2671"
 *   +447911123456   → "+44 7911 123456"
 */
function formatE164Human(e164: string): string {
  if (!e164.startsWith("+")) return e164;

  // Nigerian numbers: +234 XXX XXX XXXX
  if (e164.startsWith("+234") && e164.length === 14) {
    return `+234 ${e164.slice(4, 7)} ${e164.slice(7, 10)} ${e164.slice(10)}`;
  }

  // US/Canada (+1): +1 XXX XXX XXXX
  if (e164.startsWith("+1") && e164.length === 12) {
    return `+1 ${e164.slice(2, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}`;
  }

  // Generic: "+CC XXXXXXXXXXXXXXX" — group after the country code (2-3 digits)
  const digits = e164.slice(1);
  if (digits.length <= 4) return e164;
  // Try to guess country code length (1-3 digits) — use 2 as safe default
  const ccLen = digits.length > 11 ? 3 : digits.length > 9 ? 2 : 1;
  const cc = digits.slice(0, ccLen);
  const rest = digits.slice(ccLen);
  return `+${cc} ${rest}`;
}

// ── Component props ───────────────────────────────────────────────────────────

interface PhoneInputProps {
  /** Field name used by react-hook-form register. */
  name?: string;
  /** Controlled or initial value (raw or E.164). */
  value?: string;
  /** Error message from react-hook-form validation. */
  error?: string;
  /** Called whenever the underlying input changes. */
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  /** Called when the input loses focus. */
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  /** Whether to default to Nigerian (+234) mode (true by default). */
  defaultNigerian?: boolean;
  /** aria-label for the input. */
  label?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  {
    name,
    value: controlledValue,
    error,
    onChange,
    onBlur,
    defaultNigerian = true,
    label = "Recipient's Phone",
  },
  ref
) {
  const [rawValue, setRawValue] = useState(controlledValue ?? "");
  const [isInternational, setIsInternational] = useState(!defaultNigerian);
  const [touched, setTouched] = useState(false);

  // Derived normalisation state — computed on every render (cheap)
  const normalized = normalizePhone(rawValue);
  const humanFormatted = normalized ? formatE164Human(normalized) : null;

  // Show the validation hint only after the field has been touched
  const showError = touched && error;
  const showNormalized = touched && rawValue.length > 3 && normalized;
  const showInvalidHint = touched && rawValue.length > 3 && !normalized && !error;

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setRawValue(e.target.value);
      onChange?.(e);
    },
    [onChange]
  );

  const handleBlur = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      setTouched(true);
      onBlur?.(e);
    },
    [onBlur]
  );

  const toggleInternational = () => {
    setIsInternational((prev) => !prev);
  };

  const placeholder = isInternational ? "+44 7911 123456" : "0801 234 5678 or +234 801 234 5678";

  return (
    <div className={styles.wrapper}>
      {/* Label row with international toggle */}
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={name}>
          {label}
        </label>
        <button
          type="button"
          className={`${styles.toggleBtn} ${isInternational ? styles.active : ""}`}
          onClick={toggleInternational}
          aria-pressed={isInternational}
          title={isInternational ? "Switch to Nigerian numbers" : "Enable international numbers"}
        >
          {isInternational ? "🌍 International" : "🇳🇬 Nigerian (+234)"}
        </button>
      </div>

      {/* Input */}
      <input
        ref={ref}
        id={name}
        name={name}
        type="tel"
        autoComplete="tel"
        className={`${styles.input} ${showError ? styles.inputError : ""}`}
        placeholder={placeholder}
        value={controlledValue !== undefined ? controlledValue : rawValue}
        onChange={handleChange}
        onBlur={handleBlur}
        aria-invalid={!!showError}
        aria-describedby={
          [showError && `${name}-error`, showNormalized && `${name}-hint`]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />

      {/* Live E.164 normalisation preview */}
      {showNormalized && humanFormatted && (
        <p id={`${name}-hint`} className={styles.hint} aria-live="polite">
          ✓ Will be stored as <span className={styles.e164}>{normalized}</span>
          {" · "}
          <span className={styles.human}>{humanFormatted}</span>
        </p>
      )}

      {/* Unrecognisable number hint (before Zod fires) */}
      {showInvalidHint && (
        <p className={styles.invalidHint} aria-live="polite">
          Enter a valid phone number (e.g. 0801 234 5678 or +234 801 234 5678)
        </p>
      )}

      {/* react-hook-form validation error */}
      {showError && (
        <p id={`${name}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
