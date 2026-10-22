"use client";

/**
 * DateTimeInput — shared UTC-aware date/time input component (issue #51).
 *
 * Wraps <input type="datetime-local"> with:
 *  - Full ARIA labelling (label, hint, error, min/max semantics)
 *  - UTC conversion: the value the consumer receives and sets is always a
 *    UTC ISO-8601 string; the input displays the equivalent local time
 *  - DST ambiguity warning when the picked time falls in a spring-forward gap
 *  - Accessible error/hint messaging via aria-describedby
 */

import { forwardRef, useId, useEffect, useState } from "react";
import { localDateTimeToUtcIso, isAmbiguousDstTransition } from "@/lib/dateFormat";
import styles from "./DateTimeInput.module.css";

export interface DateTimeInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> {
  /** Visible label text (required for accessibility). */
  label: string;
  /**
   * The current value as a UTC ISO-8601 string (e.g. "2025-06-01T10:00:00.000Z").
   * Pass an empty string when no value has been selected.
   */
  value?: string;
  /**
   * Called with the new UTC ISO-8601 string whenever the user changes the input.
   * Receives an empty string when the field is cleared.
   */
  onChange?: (utcIso: string) => void;
  /** Helper text shown below the input when there is no error. */
  hint?: string;
  /** Validation error message. When set, the input is marked aria-invalid. */
  error?: string;
  /**
   * Minimum selectable datetime as a UTC ISO-8601 string.
   * Defaults to the current moment (prevents selecting dates in the past).
   */
  minUtc?: string;
  /**
   * Maximum selectable datetime as a UTC ISO-8601 string.
   */
  maxUtc?: string;
  /** Extra CSS class applied to the root wrapper div. */
  className?: string;
}

/**
 * Converts a UTC ISO string to the "YYYY-MM-DDTHH:mm" format that
 * <input type="datetime-local"> expects.
 */
function utcIsoToLocalDateTimeValue(utcIso: string): string {
  if (!utcIso) return "";
  const date = new Date(utcIso);
  if (isNaN(date.getTime())) return "";
  // Shift from UTC to local time, then format without timezone offset
  const localMs = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localMs).toISOString().slice(0, 16);
}

/**
 * Converts a UTC ISO string to the datetime-local min/max attribute format.
 */
function utcIsoToMinMaxAttr(utcIso: string): string {
  return utcIsoToLocalDateTimeValue(utcIso);
}

export const DateTimeInput = forwardRef<HTMLInputElement, DateTimeInputProps>(
  function DateTimeInput(
    {
      label,
      value = "",
      onChange,
      hint,
      error,
      minUtc,
      maxUtc,
      id: externalId,
      className,
      disabled,
      ...rest
    },
    ref
  ) {
    const autoId = useId();
    const inputId = externalId ?? autoId;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;
    const dstWarningId = `${inputId}-dst`;

    // Track DST warning separately so it doesn't interfere with the error prop
    const [dstWarning, setDstWarning] = useState(false);

    // The displayed local value is derived from the incoming UTC value
    const localValue = utcIsoToLocalDateTimeValue(value);

    // Recalculate DST warning whenever localValue changes
    useEffect(() => {
      setDstWarning(localValue ? isAmbiguousDstTransition(localValue) : false);
    }, [localValue]);

    // Compute default min: now (prevents selecting past dates)
    const defaultMinLocal = utcIsoToLocalDateTimeValue(new Date().toISOString());
    const minAttr = minUtc ? utcIsoToMinMaxAttr(minUtc) : defaultMinLocal;
    const maxAttr = maxUtc ? utcIsoToMinMaxAttr(maxUtc) : undefined;

    // Build aria-describedby from active descriptors
    const describedByIds = [
      error ? errorId : null,
      dstWarning ? dstWarningId : null,
      !error && hint ? hintId : null,
    ]
      .filter(Boolean)
      .join(" ");

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value;
      if (!raw) {
        onChange?.("");
        return;
      }
      // Convert local picker value to UTC before surfacing to the consumer
      const utcIso = localDateTimeToUtcIso(raw);
      onChange?.(utcIso);
    }

    return (
      <div className={[styles.wrapper, className].filter(Boolean).join(" ")}>
        <label className={styles.label} htmlFor={inputId}>
          {label}
        </label>

        <input
          {...rest}
          ref={ref}
          id={inputId}
          type="datetime-local"
          className={[styles.input, error ? styles.inputError : ""].filter(Boolean).join(" ")}
          value={localValue}
          onChange={handleChange}
          min={minAttr}
          max={maxAttr}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={describedByIds || undefined}
          aria-required={rest.required}
        />

        {/* Timezone context — always visible so users understand the local offset */}
        <span className={styles.timezone} aria-live="polite">
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>

        {/* DST ambiguity warning */}
        {dstWarning && (
          <span id={dstWarningId} className={styles.warning} role="alert">
            This time may not exist due to a Daylight Saving Time change. Please double-check your
            selection.
          </span>
        )}

        {/* Hint text — shown only when there is no error */}
        {hint && !error && (
          <span id={hintId} className={styles.hint}>
            {hint}
          </span>
        )}

        {/* Error message */}
        {error && (
          <span id={errorId} className={styles.errorMsg} role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }
);

DateTimeInput.displayName = "DateTimeInput";
