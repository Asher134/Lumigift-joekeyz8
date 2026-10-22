"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { useTranslation, SUPPORTED_LOCALES } from "@/i18n";
import type { Locale } from "@/i18n/types";
import styles from "./Navbar.module.css";

const NAV_HREFS = [
  { href: "/send", labelKey: "nav.send_gift" as const },
  { href: "/dashboard", labelKey: "nav.dashboard" as const },
];

export function Navbar() {
  const pathname = usePathname();
  const { t, locale, setLocale } = useTranslation();

  return (
    <header className={styles.header}>
      <nav className={`container ${styles.nav}`} aria-label="Main navigation">
        <Link href="/" className={styles.logo} aria-label="Lumigift home">
          <span className={styles.logoMark}>Z</span>
          <span className={styles.logoText}>Lumigift</span>
        </Link>

        <ul className={styles.links} role="list">
          {NAV_HREFS.map(({ href, labelKey }) => {
            const isActive = pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`${styles.link} ${isActive ? styles.linkActive : ""}`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {t(labelKey)}
                </Link>
              </li>
            );
          })}

          {/* ── Language selector ──────────────────────────────────────── */}
          <li>
            <label htmlFor="lang-select" className="sr-only">
              {t("nav.language_selector")}
            </label>
            <select
              id="lang-select"
              className={styles.langSelect}
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              aria-label={t("nav.select_language")}
            >
              {SUPPORTED_LOCALES.map(({ code, nativeLabel }) => (
                <option key={code} value={code}>
                  {nativeLabel}
                </option>
              ))}
            </select>
          </li>

          <li>
            <ThemeToggle />
          </li>
          <li>
            <NotificationBell />
          </li>
          <li>
            <Link href="/auth/login" className="btn btn--primary btn--sm">
              {t("nav.sign_in")}
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
