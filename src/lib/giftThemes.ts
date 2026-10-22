import type { CSSProperties } from "react";

/**
 * Occasion-based background themes for gift cards (issue #348).
 *
 * Images live in Cloudinary under `lumigift/themes/<id>.jpg` and are always
 * requested with `f_auto,q_auto:eco` plus a bounded width so every delivered
 * variant stays under {@link MAX_THEME_BYTES}. A gradient fallback is painted
 * underneath so cards stay legible while the image loads (or if it fails).
 */

export const GIFT_THEME_IDS = [
  "classic",
  "birthday",
  "valentine",
  "graduation",
  "wedding",
  "celebration",
] as const;

export type GiftThemeId = (typeof GIFT_THEME_IDS)[number];

export interface GiftTheme {
  id: GiftThemeId;
  label: string;
  fallback: string;
}

export const MAX_THEME_BYTES = 100 * 1024;

/** Widths requested from Cloudinary — capped so no variant exceeds 100 KB. */
const THEME_WIDTHS = { sm: 480, lg: 960 } as const;

export const GIFT_THEMES: readonly GiftTheme[] = [
  { id: "classic", label: "Classic", fallback: "linear-gradient(135deg, #1e1b4b, #312e81)" },
  { id: "birthday", label: "Birthday", fallback: "linear-gradient(135deg, #f59e0b, #ec4899)" },
  { id: "valentine", label: "Valentine", fallback: "linear-gradient(135deg, #be123c, #f472b6)" },
  { id: "graduation", label: "Graduation", fallback: "linear-gradient(135deg, #0f172a, #2563eb)" },
  { id: "wedding", label: "Wedding", fallback: "linear-gradient(135deg, #a78bfa, #fde68a)" },
  {
    id: "celebration",
    label: "Celebration",
    fallback: "linear-gradient(135deg, #059669, #facc15)",
  },
];

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "lumigift";

export function themeImageUrl(id: GiftThemeId, width: number): string {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto:eco,c_fill,w_${width}/lumigift/themes/${id}.jpg`;
}

export function getGiftTheme(id?: string | null): GiftTheme | undefined {
  return GIFT_THEMES.find((t) => t.id === id);
}

/**
 * Inline style exposing responsive background URLs as CSS custom properties.
 * Pair with the global `.gift-theme` class, which picks the right size.
 */
export function giftThemeStyle(id?: string | null): CSSProperties | undefined {
  const theme = getGiftTheme(id);
  if (!theme) return undefined;
  return {
    "--gift-theme-sm": `url("${themeImageUrl(theme.id, THEME_WIDTHS.sm)}")`,
    "--gift-theme-lg": `url("${themeImageUrl(theme.id, THEME_WIDTHS.lg)}")`,
    "--gift-theme-fallback": theme.fallback,
  } as CSSProperties;
}
