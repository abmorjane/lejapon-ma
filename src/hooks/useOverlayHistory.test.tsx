import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_HISTORY_STATE_KEY, useOverlayHistory } from "./useOverlayHistory";

function SingleOverlayHarness() {
  const [open, setOpen] = useState(false);
  const overlay = useOverlayHistory(open, () => setOpen(false), "test-overlay");
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <button onClick={() => overlay.requestClose()}>Close</button>}
      <span data-testid="state">{open ? "open" : "closed"}</span>
    </div>
  );
}

function NestedOverlayHarness() {
  const [parentOpen, setParentOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  useOverlayHistory(parentOpen, () => setParentOpen(false), "parent");
  useOverlayHistory(childOpen, () => setChildOpen(false), "child");
  return (
    <div>
      <button onClick={() => setParentOpen(true)}>Open parent</button>
      {parentOpen && <button onClick={() => setChildOpen(true)}>Open child</button>}
      <span data-testid="parent">{parentOpen ? "open" : "closed"}</span>
      <span data-testid="child">{childOpen ? "open" : "closed"}</span>
    </div>
  );
}

const currentStack = () => window.history.state?.[OVERLAY_HISTORY_STATE_KEY] as string[] ?? [];

beforeEach(() => {
  window.history.replaceState({}, "", "/admin/bookings");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useOverlayHistory", () => {
  it("pushes one same-URL entry and closes on browser back", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    render(<SingleOverlayHarness />);
    fireEvent.click(screen.getByText("Open"));
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/admin/bookings");

    const token = currentStack()[0];
    expect(token).toContain("test-overlay");
    act(() => {
      window.history.replaceState({ [OVERLAY_HISTORY_STATE_KEY]: [] }, "", window.location.href);
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    });
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("does not multiply history entries when the overlay rerenders", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const { rerender } = render(<SingleOverlayHarness />);
    fireEvent.click(screen.getByText("Open"));
    rerender(<SingleOverlayHarness />);
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it("closes nested overlays from top to bottom", () => {
    render(<NestedOverlayHarness />);
    fireEvent.click(screen.getByText("Open parent"));
    const parentState = window.history.state;
    fireEvent.click(screen.getByText("Open child"));
    const baseState = { [OVERLAY_HISTORY_STATE_KEY]: [] };

    act(() => {
      window.history.replaceState(parentState, "", window.location.href);
      window.dispatchEvent(new PopStateEvent("popstate", { state: parentState }));
    });
    expect(screen.getByTestId("parent")).toHaveTextContent("open");
    expect(screen.getByTestId("child")).toHaveTextContent("closed");

    act(() => {
      window.history.replaceState(baseState, "", window.location.href);
      window.dispatchEvent(new PopStateEvent("popstate", { state: baseState }));
    });
    expect(screen.getByTestId("parent")).toHaveTextContent("closed");
  });

  it("uses history.back for an explicit close", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    render(<SingleOverlayHarness />);
    fireEvent.click(screen.getByText("Open"));
    fireEvent.click(screen.getByText("Close"));
    expect(back).toHaveBeenCalledTimes(1);
  });
});
