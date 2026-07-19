import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

// localStorage slot for never-saved quizzes (no quiz row to attach a server
// draft to). Tenant slug + user id so shared machines/tenants don't collide.
export function newQuizDraftKey(tenantSlug: string, userId: number): string {
  return `quizDraft:new:${tenantSlug}:${userId}`;
}

interface UseQuizAutosaveOpts {
  quizId?: string;      // set in edit mode → server draft
  storageKey?: string;  // set in create mode → localStorage
  enabled: boolean;     // false until hydration + draft decision resolved
  paused: boolean;      // true while the explicit Save mutation is in flight
  payload: unknown;     // the current QuizForm state
  debounceMs?: number;
}

// Debounced draft autosave. `markClean(p)` declares p as "already persisted /
// nothing to write" — call it after hydration, after resuming a draft, and
// after discarding. A payload serially identical to the last clean/written
// state never triggers a write, so hydration alone NEVER creates a draft
// (draft existence must keep meaning "unsaved changes").
export function useQuizAutosave({ quizId, storageKey, enabled, paused, payload, debounceMs = 2500 }: UseQuizAutosaveOpts) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const lastWrittenRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markClean = (p: unknown) => {
    lastWrittenRef.current = JSON.stringify(p);
    setStatus("idle");
  };

  useEffect(() => {
    if (!enabled || paused) return;
    const serialized = JSON.stringify(payload);
    if (serialized === lastWrittenRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        if (quizId) {
          await apiRequest("PUT", `/api/quizzes/${quizId}/draft`, JSON.parse(serialized));
        } else if (storageKey) {
          localStorage.setItem(storageKey, JSON.stringify({ payload: JSON.parse(serialized), updatedAt: new Date().toISOString() }));
        }
        lastWrittenRef.current = serialized;
        setStatus("saved");
        setSavedAt(new Date());
      } catch {
        // Work is still in editor memory; the next change re-triggers. No toast
        // spam — the chip shows the retry state.
        setStatus("error");
      }
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [payload, enabled, paused, quizId, storageKey, debounceMs]);

  return { status, savedAt, markClean };
}
