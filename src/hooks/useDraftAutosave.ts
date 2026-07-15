import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DraftEnvelope<T> = {
  version: 1;
  savedAt: string;
  data: T;
};

type UseDraftAutosaveOptions<T> = {
  key: string | null;
  value: T;
  enabled?: boolean;
  dirty?: boolean;
  delayMs?: number;
  onRestore: (value: T) => void;
};

const readDraft = <T,>(key: string): DraftEnvelope<T> | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftEnvelope<T>;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
};

export function useUnsavedChangesGuard(enabled: boolean, message = "Vous avez des modifications non enregistrées.") {
  useEffect(() => {
    if (!enabled) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [enabled, message]);
}

export function useDraftAutosave<T>({
  key,
  value,
  enabled = true,
  dirty = true,
  delayMs = 1500,
  onRestore,
}: UseDraftAutosaveOptions<T>) {
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const restoredKey = useRef<string | null>(null);
  const onRestoreRef = useRef(onRestore);

  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  useEffect(() => {
    if (!enabled || !key) {
      setHasDraft(false);
      setRestoredAt(null);
      restoredKey.current = null;
      return;
    }
    const draft = readDraft<T>(key);
    setHasDraft(Boolean(draft));
    setRestoredAt(null);
    if (draft && restoredKey.current !== key) {
      restoredKey.current = key;
      onRestoreRef.current(draft.data);
      setRestoredAt(draft.savedAt);
    }
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled || !key || !dirty) return;
    const timeout = window.setTimeout(() => {
      try {
        const envelope: DraftEnvelope<T> = {
          version: 1,
          savedAt: new Date().toISOString(),
          data: value,
        };
        window.localStorage.setItem(key, JSON.stringify(envelope));
        setHasDraft(true);
      } catch {
        // localStorage can be unavailable or full; the form must keep working.
      }
    }, delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, dirty, enabled, key, value]);

  const clearDraft = useCallback(() => {
    if (!key) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
    setHasDraft(false);
    setRestoredAt(null);
    if (restoredKey.current === key) restoredKey.current = null;
  }, [key]);

  return useMemo(() => ({ hasDraft, restoredAt, clearDraft }), [clearDraft, hasDraft, restoredAt]);
}
