"use client";

/**
 * SupportWidget
 *
 * Floating support button rendered on every page that lets signed-in users:
 *  - Open a new support case (subject + description)
 *  - Browse their previous cases with status
 *  - Read and reply to the agent conversation thread
 *  - See an unread indicator when an agent has replied
 *
 * Hidden for anonymous visitors (the cases API returns 401).
 *
 * Issue #347 — In-app chat support widget
 */

import { useEffect, useRef, useState } from "react";
import { useCsrf } from "@/hooks/useCsrf";
import type { SupportCase } from "@/types";
import styles from "./SupportWidget.module.css";

const POLL_INTERVAL_MS = 60_000;

type View = { kind: "list" } | { kind: "new" } | { kind: "thread"; caseReference: string };

export function SupportWidget() {
  const { csrfFetch } = useCsrf();
  const [authenticated, setAuthenticated] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: "list" });
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [activeCase, setActiveCase] = useState<SupportCase | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  async function fetchCases() {
    try {
      const res = await fetch("/api/v1/support/cases");
      setAuthenticated(res.status !== 401);
      if (!res.ok) return;
      const json = (await res.json()) as { success: boolean; data?: SupportCase[] };
      if (json.success && json.data) setCases(json.data);
    } catch {
      // Network error — keep last known state
    }
  }

  useEffect(() => {
    // Initial fetch + polling, same pattern as NotificationBell
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCases();
    const id = setInterval(fetchCases, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function openThread(caseReference: string) {
    setError(null);
    setView({ kind: "thread", caseReference });
    const res = await fetch(`/api/v1/support/cases/${encodeURIComponent(caseReference)}`);
    const json = (await res.json()) as { success: boolean; data?: SupportCase };
    if (json.success && json.data) {
      setActiveCase(json.data);
      setCases((prev) =>
        prev.map((c) => (c.caseReference === caseReference ? { ...c, hasUnreadReply: false } : c))
      );
    }
  }

  async function submitCase(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await csrfFetch("/api/v1/support/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: subject, details: description }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Could not open case");
      setSubject("");
      setDescription("");
      await fetchCases();
      setView({ kind: "list" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCase) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await csrfFetch(
        `/api/v1/support/cases/${encodeURIComponent(activeCase.caseReference)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: reply }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Could not send message");
      setActiveCase(json.data);
      setReply("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!authenticated) return null;

  const hasUnread = cases.some((c) => c.hasUnreadReply);

  return (
    <div className={styles.root}>
      {open && (
        <section
          id="support-widget-panel"
          className={styles.panel}
          role="dialog"
          aria-modal="false"
          aria-labelledby="support-widget-title"
        >
          <header className={styles.header}>
            <h2 id="support-widget-title" className={styles.title}>
              Support
            </h2>
            {view.kind !== "list" && (
              <button
                type="button"
                className={styles.link}
                onClick={() => setView({ kind: "list" })}
              >
                ← Back
              </button>
            )}
          </header>

          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}

          {view.kind === "list" && (
            <>
              <button
                type="button"
                className={styles.primary}
                onClick={() => setView({ kind: "new" })}
              >
                New case
              </button>
              {cases.length === 0 ? (
                <p className={styles.muted}>No support cases yet.</p>
              ) : (
                <ul className={styles.list}>
                  {cases.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={styles.caseItem}
                        onClick={() => openThread(c.caseReference)}
                      >
                        <span className={styles.caseSubject}>
                          {c.reason}
                          {c.hasUnreadReply && <span className={styles.srOnly}> (new reply)</span>}
                        </span>
                        <span className={styles.caseMeta}>
                          {c.caseReference} · {c.status}
                          {c.hasUnreadReply && <span className={styles.dot} aria-hidden="true" />}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {view.kind === "new" && (
            <form className={styles.form} onSubmit={submitCase}>
              <label className="input-label" htmlFor="support-subject">
                Subject
              </label>
              <input
                id="support-subject"
                className="input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                maxLength={120}
              />
              <label className="input-label" htmlFor="support-description">
                Description
              </label>
              <textarea
                id="support-description"
                className="input"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                maxLength={2000}
              />
              <button type="submit" className={styles.primary} disabled={submitting}>
                {submitting ? "Submitting…" : "Open case"}
              </button>
            </form>
          )}

          {view.kind === "thread" && (
            <>
              {!activeCase || activeCase.caseReference !== view.caseReference ? (
                <p className={styles.muted}>Loading…</p>
              ) : (
                <>
                  <p className={styles.caseSubject}>{activeCase.reason}</p>
                  <p className={styles.caseMeta}>
                    {activeCase.caseReference} · {activeCase.status}
                  </p>
                  <ol className={styles.thread} aria-label="Conversation">
                    {activeCase.details && <li className={styles.userMsg}>{activeCase.details}</li>}
                    {activeCase.messages.map((m) => (
                      <li
                        key={m.id}
                        className={m.author === "agent" ? styles.agentMsg : styles.userMsg}
                      >
                        <span className={styles.srOnly}>
                          {m.author === "agent" ? "Support agent: " : "You: "}
                        </span>
                        {m.body}
                      </li>
                    ))}
                  </ol>
                  <form className={styles.form} onSubmit={submitReply}>
                    <label className="input-label" htmlFor="support-reply">
                      Reply
                    </label>
                    <textarea
                      id="support-reply"
                      className="input"
                      rows={2}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      required
                      maxLength={2000}
                    />
                    <button type="submit" className={styles.primary} disabled={submitting}>
                      Send
                    </button>
                  </form>
                </>
              )}
            </>
          )}
        </section>
      )}

      <button
        ref={toggleRef}
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls="support-widget-panel"
        aria-label={hasUnread ? "Support (new reply)" : "Support"}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">💬</span>
        {hasUnread && <span className={styles.badge} aria-hidden="true" />}
      </button>
    </div>
  );
}
