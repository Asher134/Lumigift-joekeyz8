"use client";

import { useState, useCallback, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import type { ApiResponse } from "@/types";
import styles from "./page.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserProfile {
  id: string;
  phone: string;
  displayName: string | null;
  email?: string | null;
}

interface NotificationPreferenceEntry {
  channel: "sms" | "email" | "push";
  category: "security" | "lifecycle" | "marketing";
  enabled: boolean;
}

interface UserMeResponse {
  user: UserProfile;
  notificationPreferences: NotificationPreferenceEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Masks a phone number so only the last 4 digits are visible.
 * e.g. "+2348012345678" → "+234 ••••5678"
 */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  const last4 = phone.slice(-4);
  const prefix = phone.slice(0, phone.length - 8);
  return `${prefix} ••••${last4}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  security: "Security alerts",
  lifecycle: "Gift updates",
  marketing: "Promotions & news",
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  security: "OTP codes and suspicious-login alerts — always on.",
  lifecycle: "Notifications when your gifts are funded, unlocked, or claimed.",
  marketing: "New features, promotions, and Lumigift news.",
};

const CHANNEL_LABELS: Record<string, string> = {
  sms: "SMS",
  email: "Email",
  push: "Push",
};

async function fetchMe(): Promise<UserMeResponse> {
  const res = await fetch("/api/v1/users/me");
  const json: ApiResponse<UserMeResponse> = await res.json();
  if (!json.success)
    throw new Error((json as { error?: string }).error ?? "Failed to load profile");
  return json.data;
}

async function patchNotificationPreference(entry: NotificationPreferenceEntry): Promise<void> {
  const res = await fetch("/api/v1/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferences: [entry] }),
  });
  const json: ApiResponse<unknown> = await res.json();
  if (!json.success)
    throw new Error((json as { error?: string }).error ?? "Failed to update preference");
}

// ─── Sub-component: Toggle ────────────────────────────────────────────────────

interface ToggleProps {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  "aria-label": string;
}

function Toggle({ id, checked, disabled, onChange, "aria-label": ariaLabel }: ToggleProps) {
  return (
    <label className={styles.toggle} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className={styles.toggleInput}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
      />
      <span className={styles.toggleTrack} aria-hidden="true" />
    </label>
  );
}

// ─── Sub-component: Preference row ────────────────────────────────────────────

interface PrefRowProps {
  entry: NotificationPreferenceEntry;
  onToggle: (entry: NotificationPreferenceEntry, enabled: boolean) => void;
  saving: boolean;
  error: string | null;
}

function PrefRow({ entry, onToggle, saving, error }: PrefRowProps) {
  const id = useId();
  const isMandatory = entry.category === "security";
  const toggleId = `${id}-toggle`;
  const errorId = `${id}-error`;

  return (
    <div className={styles.prefRow}>
      <div className={styles.prefInfo}>
        <span className={styles.prefLabel}>
          {CHANNEL_LABELS[entry.channel]} — {CATEGORY_LABELS[entry.category]}
        </span>
        <span className={styles.prefDesc}>{CATEGORY_DESCRIPTIONS[entry.category]}</span>
        {isMandatory && (
          <span className={styles.prefMandatory} aria-live="polite">
            Always enabled — cannot be turned off
          </span>
        )}
        {error && (
          <span id={errorId} className={styles.errorBanner} role="alert" aria-live="assertive">
            {error}
          </span>
        )}
      </div>
      <Toggle
        id={toggleId}
        checked={entry.enabled}
        disabled={isMandatory || saving}
        onChange={(checked) => onToggle(entry, checked)}
        aria-label={`${isMandatory ? "Always enabled: " : ""}${CHANNEL_LABELS[entry.channel]} notifications for ${CATEGORY_LABELS[entry.category]}`}
      />
    </div>
  );
}

// ─── Skeleton loading ─────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading profile">
      <span className="sr-only" role="status" aria-live="polite">
        Loading your profile…
      </span>
      <div className={styles.section} aria-hidden="true">
        <div className={`${styles.bone} ${styles.skeletonLine} ${styles["skeletonLine--sm"]}`} />
        <div className={`${styles.bone} ${styles.skeletonLine} ${styles["skeletonLine--md"]}`} />
        <div className={`${styles.bone} ${styles.skeletonLine} ${styles["skeletonLine--lg"]}`} />
      </div>
      <div className={styles.section} aria-hidden="true">
        <div className={`${styles.bone} ${styles.skeletonLine} ${styles["skeletonLine--sm"]}`} />
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`${styles.bone} ${styles.skeletonLine} ${styles["skeletonLine--lg"]}`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function ProfilePage() {
  const { status: authStatus } = useAuthGuard();
  const queryClient = useQueryClient();

  // Track per-preference save errors (key: "channel:category")
  const [prefErrors, setPrefErrors] = useState<Record<string, string>>({});

  const { data, status, error, refetch } = useQuery<UserMeResponse, Error>({
    queryKey: ["users", "me"],
    queryFn: fetchMe,
    enabled: authStatus === "authenticated",
  });

  const { mutate: savePreference } = useMutation<
    void,
    Error,
    NotificationPreferenceEntry,
    { previousData: UserMeResponse | undefined }
  >({
    mutationFn: patchNotificationPreference,

    // Optimistic update
    onMutate: async (updated) => {
      await queryClient.cancelQueries({ queryKey: ["users", "me"] });
      const previousData = queryClient.getQueryData<UserMeResponse>(["users", "me"]);

      queryClient.setQueryData<UserMeResponse>(["users", "me"], (old) => {
        if (!old) return old;
        return {
          ...old,
          notificationPreferences: old.notificationPreferences.map((p) =>
            p.channel === updated.channel && p.category === updated.category
              ? { ...p, enabled: updated.enabled }
              : p
          ),
        };
      });

      // Clear any existing error for this preference
      const key = `${updated.channel}:${updated.category}`;
      setPrefErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      return { previousData };
    },

    // Rollback on error
    onError: (err, updated, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(["users", "me"], context.previousData);
      }
      const key = `${updated.channel}:${updated.category}`;
      setPrefErrors((prev) => ({ ...prev, [key]: err.message }));
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
    },
  });

  const handleToggle = useCallback(
    (entry: NotificationPreferenceEntry, enabled: boolean) => {
      savePreference({ ...entry, enabled });
    },
    [savePreference]
  );

  // ── Auth guard loading ───────────────────────────────────────────────────
  if (authStatus === "loading") {
    return (
      <div className={styles.page}>
        <div className="container container--sm">
          <h1 className={styles.title}>Profile</h1>
          <ProfileSkeleton />
        </div>
      </div>
    );
  }

  // ── Data loading ─────────────────────────────────────────────────────────
  if (status === "pending") {
    return (
      <div className={styles.page}>
        <div className="container container--sm">
          <h1 className={styles.title}>Profile</h1>
          <ProfileSkeleton />
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className={styles.page}>
        <div className="container container--sm">
          <h1 className={styles.title}>Profile</h1>
          <div className={styles.error} role="alert">
            <p className={styles.errorMessage}>
              {error?.message ?? "Failed to load your profile. Please try again."}
            </p>
            <button
              className="btn btn--secondary"
              onClick={() => refetch()}
              aria-label="Retry loading profile"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { user, notificationPreferences } = data!;
  const maskedPhone = maskPhone(user.phone);

  return (
    <div className={styles.page}>
      <div className="container container--sm">
        <h1 className={styles.title}>Profile</h1>

        {/* ── Account details ─────────────────────────────────────────────── */}
        <section className={styles.section} aria-labelledby="profile-account-heading">
          <h2 className={styles.sectionTitle} id="profile-account-heading">
            Account details
          </h2>
          <dl>
            <div className={styles.profileRow}>
              <dt className={styles.label}>Phone number</dt>
              <dd
                className={`${styles.value} ${styles.maskedPhone}`}
                aria-label={`Phone number ending in ${user.phone.slice(-4)}`}
              >
                {maskedPhone}
              </dd>
            </div>
            {user.displayName && (
              <div className={styles.profileRow} style={{ marginTop: "var(--space-4)" }}>
                <dt className={styles.label}>Name</dt>
                <dd className={styles.value}>{user.displayName}</dd>
              </div>
            )}
            {user.email && (
              <div className={styles.profileRow} style={{ marginTop: "var(--space-4)" }}>
                <dt className={styles.label}>Email</dt>
                <dd className={styles.value}>{user.email}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* ── Notification preferences ─────────────────────────────────────── */}
        <section className={styles.section} aria-labelledby="profile-prefs-heading">
          <h2 className={styles.sectionTitle} id="profile-prefs-heading">
            Notification preferences
          </h2>
          <div
            className={styles.prefsGrid}
            role="list"
            aria-label="Notification preference toggles"
          >
            {notificationPreferences.map((entry) => {
              const key = `${entry.channel}:${entry.category}`;
              return (
                <div key={key} role="listitem">
                  <PrefRow
                    entry={entry}
                    onToggle={handleToggle}
                    saving={false}
                    error={prefErrors[key] ?? null}
                  />
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
