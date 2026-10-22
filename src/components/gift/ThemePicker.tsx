"use client";

import { GIFT_THEMES, giftThemeStyle, type GiftThemeId } from "@/lib/giftThemes";
import styles from "./ThemePicker.module.css";

interface ThemePickerProps {
  value?: GiftThemeId;
  onChange: (id: GiftThemeId) => void;
}

/** Preset background picker for the gift card (issue #348). */
export function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    <fieldset className={styles.picker}>
      <legend className="input-label">Card Theme</legend>
      <div className={styles.grid} role="radiogroup" aria-label="Card theme">
        {GIFT_THEMES.map((theme) => {
          const selected = value === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`${styles.swatch} gift-theme${selected ? ` ${styles.selected}` : ""}`}
              style={giftThemeStyle(theme.id)}
              onClick={() => onChange(theme.id)}
            >
              <span className={styles.label}>{theme.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
