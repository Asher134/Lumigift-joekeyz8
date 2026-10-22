"use client";

import { useEffect, useState } from "react";
import styles from "./ThemeToggle.module.css";

type Theme = "dark" | "light";

/**
 * Reads the active theme from localStorage or the OS preference.
 * Must only be called after mount (requires window).
 */
function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("theme") as Theme | null;
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * ThemeToggle — switches between dark and light mode.
 *
 * Behaviour:
 * - On first mount, reads theme from localStorage; falls back to OS preference.
 * - Writes the user's choice to localStorage so it survives page reloads.
 * - Sets `data-theme` on <html> so CSS tokens pick up the correct palette.
 * - Renders `null` until mounted to avoid a server/client hydration mismatch
 *   (the inline script in layout.tsx already applies the correct class before
 *   paint, so there is no visible flash of wrong theme).
 * - Keyboard accessible: standard <button>, full focus ring via globals.css.
 * - aria-label is updated dynamically to announce the *next* action.
 * - aria-pressed reflects the current state for AT users.
 */
export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");

  // Sync theme state from DOM / localStorage on mount only.
  // Using `suppressHydrationWarning` on <html> in layout.tsx means the
  // server-rendered markup is accepted as-is; this effect corrects state.
  useEffect(() => {
    const t = getInitialTheme();
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  }

  // Render nothing until mounted — the FOUC-prevention script in layout.tsx
  // already set `data-theme` before React hydrates, so the page looks correct
  // even while this component is invisible.
  if (!mounted) {
    return (
      <button
        className={styles.toggle}
        aria-label="Toggle colour theme"
        aria-pressed={false}
        disabled
        aria-hidden="true"
      />
    );
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      className={styles.toggle}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-pressed={!isDark}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      {/* Icon is decorative — aria-label on the button carries the meaning */}
      <span aria-hidden="true">{isDark ? "☀️" : "🌙"}</span>
    </button>
  );
}
