import { useCallback, useEffect, useRef } from "react";

export const OVERLAY_HISTORY_STATE_KEY = "__lejaponAdminOverlayStack";

type AfterClose = (() => void) | undefined;

type OverlayHistoryController = {
  requestClose: (afterClose?: AfterClose) => void;
  handleOpenChange: (nextOpen: boolean) => void;
};

let overlaySequence = 0;

const stateObject = (state: unknown): Record<string, unknown> =>
  state && typeof state === "object" ? state as Record<string, unknown> : {};

const readStack = (state: unknown): string[] => {
  const value = stateObject(state)[OVERLAY_HISTORY_STATE_KEY];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

const withStack = (state: unknown, stack: string[]) => ({
  ...stateObject(state),
  [OVERLAY_HISTORY_STATE_KEY]: stack,
});

/**
 * Adds a same-URL browser-history entry while an admin overlay is open.
 * Browser Back removes the top entry and closes only that overlay. Calling
 * requestClose consumes the same entry before invoking any follow-up action.
 */
export function useOverlayHistory(
  open: boolean,
  onClose: () => void,
  overlayId: string,
  enabled = true,
): OverlayHistoryController {
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);
  const tokenRef = useRef<string | null>(null);
  const closePendingRef = useRef(false);
  const afterCloseRef = useRef<AfterClose>(undefined);

  openRef.current = open;
  onCloseRef.current = onClose;

  const finishClose = useCallback(() => {
    const afterClose = afterCloseRef.current;
    afterCloseRef.current = undefined;
    closePendingRef.current = false;
    tokenRef.current = null;
    if (openRef.current) onCloseRef.current();
    afterClose?.();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const handlePopState = (event: PopStateEvent) => {
      const token = tokenRef.current;
      if (!token || readStack(event.state).includes(token)) return;
      finishClose();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [enabled, finishClose]);

  useEffect(() => {
    if (!enabled) return;
    if (open && !tokenRef.current) {
      const token = `${overlayId}:${Date.now()}:${++overlaySequence}`;
      tokenRef.current = token;
      const stack = readStack(window.history.state);
      window.history.pushState(withStack(window.history.state, [...stack, token]), "", window.location.href);
      return;
    }

    // Protect against a parent changing open=false without using requestClose.
    if (!open && tokenRef.current && !closePendingRef.current) {
      const token = tokenRef.current;
      const stack = readStack(window.history.state);
      if (stack.at(-1) === token) {
        closePendingRef.current = true;
        window.history.back();
      } else {
        window.history.replaceState(withStack(window.history.state, stack.filter((item) => item !== token)), "", window.location.href);
        tokenRef.current = null;
      }
    }
  }, [enabled, open, overlayId]);

  const requestClose = useCallback((afterClose?: AfterClose) => {
    afterCloseRef.current = afterClose;
    if (!enabled) {
      finishClose();
      return;
    }
    const token = tokenRef.current;
    const stack = readStack(window.history.state);

    if (token && stack.at(-1) === token) {
      if (closePendingRef.current) return;
      closePendingRef.current = true;
      window.history.back();
      return;
    }

    if (token) {
      window.history.replaceState(withStack(window.history.state, stack.filter((item) => item !== token)), "", window.location.href);
    }
    finishClose();
  }, [enabled, finishClose]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) requestClose();
  }, [requestClose]);

  return { requestClose, handleOpenChange };
}
