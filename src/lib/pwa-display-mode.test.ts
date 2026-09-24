import { afterEach, describe, expect, it, vi } from "vitest";
import { isStandalonePwa } from "./pwa-display-mode";

afterEach(() => {
  Object.defineProperty(navigator, "standalone", { configurable: true, value: undefined });
  vi.restoreAllMocks();
});

describe("PWA display mode", () => {
  it("detects standalone display mode", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    expect(isStandalonePwa()).toBe(true);
  });

  it("detects iOS navigator.standalone", () => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    expect(isStandalonePwa()).toBe(true);
  });
});
