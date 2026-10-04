import { beforeEach, describe, expect, it } from "vitest";
import {
  ATTRIBUTION_STORAGE_KEY,
  captureAttribution,
  normalizeTrafficSource,
  readStoredAttribution,
  stripOpaqueAttributionFromCurrentUrl,
} from "./attribution";

const capture = (url: string, referrer = "", now = "2026-09-28T10:00:00.000Z") =>
  captureAttribution({ url, referrer, cookie: "_fbp=fb.1.123.abc; _fbc=fb.1.123.click", now: new Date(now), storage: localStorage });

describe("marketing attribution", () => {
  beforeEach(() => localStorage.clear());

  it.each([
    ["chatgpt", "chatgpt_paid"],
    ["openai", "chatgpt_paid"],
    ["ig", "instagram"],
    ["l.instagram.com", "instagram"],
    ["facebook", "facebook"],
    ["m.facebook.com", "facebook"],
    ["google", "google"],
    ["www.google.fr", "google"],
    ["", "direct"],
  ] as const)("normalizes %s to %s", (source, expected) => {
    expect(normalizeTrafficSource(source)).toBe(expected);
  });

  it("captures every ChatGPT Ads field and gives raw oppref precedence", () => {
    const result = capture("https://www.lejapon.ma/reserver?utm_source=chatgpt&utm_medium=paid&utm_campaign=voyage_japon_maroc&utm_content=ad_42&chatgpt_campaign_id=cmp_1&chatgpt_ad_group_id=grp_1&chatgpt_ad_account_id=acct_1&oppref=opaque%2Fvalue%2Bexact&click_id=fallback%2Fvalue");
    expect(result.first_touch).toMatchObject({
      source_normalized: "chatgpt_paid",
      utm_campaign: "voyage_japon_maroc",
      utm_content: "ad_42",
      chatgpt_campaign_id: "cmp_1",
      chatgpt_ad_group_id: "grp_1",
      chatgpt_ad_account_id: "acct_1",
      oppref: "opaque%2Fvalue%2Bexact",
      click_id: "fallback%2Fvalue",
      openai_click_ref: "opaque%2Fvalue%2Bexact",
    });
  });

  it("uses click_id unchanged only when oppref is absent", () => {
    const result = capture("https://www.lejapon.ma/reserver?utm_source=openai&click_id=exact%2Bfallback");
    expect(result.last_touch.openai_click_ref).toBe("exact%2Bfallback");
    expect(result.last_touch.oppref).toBeUndefined();
  });

  it("keeps opaque ChatGPT IDs when the same campaign refreshes after URL cleanup", () => {
    const campaign = "utm_source=chatgpt&utm_medium=paid&utm_campaign=voyage_japon_maroc&utm_content=test-ad";
    capture(`https://www.lejapon.ma/voyages?${campaign}&click_id=exact%2Fclick&chatgpt_campaign_id=campaign-1&chatgpt_ad_group_id=group-1&chatgpt_ad_account_id=account-1`);
    const refreshed = capture(`https://www.lejapon.ma/voyages?${campaign}`, "", "2026-09-28T11:00:00.000Z");
    expect(refreshed.last_touch).toMatchObject({
      click_id: "exact%2Fclick", openai_click_ref: "exact%2Fclick",
      chatgpt_campaign_id: "campaign-1", chatgpt_ad_group_id: "group-1", chatgpt_ad_account_id: "account-1",
    });
  });

  it("replaces an explicit click ID without silently changing the first touch", () => {
    const campaign = "utm_source=chatgpt&utm_medium=paid&utm_campaign=voyage_japon_maroc";
    const initial = capture(`https://www.lejapon.ma/voyages?${campaign}&click_id=first-click`);
    const next = capture(`https://www.lejapon.ma/voyages?${campaign}&click_id=second-click`, "", "2026-09-28T11:00:00.000Z");
    expect(next.first_touch.click_id).toBe(initial.first_touch.click_id);
    expect(next.last_touch.click_id).toBe("second-click");
  });

  it("never carries ChatGPT click IDs to a different source or campaign", () => {
    capture("https://www.lejapon.ma/voyages?utm_source=chatgpt&utm_campaign=autumn&click_id=chatgpt-click&chatgpt_campaign_id=old-campaign");
    const google = capture("https://www.lejapon.ma/voyages?utm_source=google&utm_campaign=autumn");
    expect(google.last_touch.source_normalized).toBe("google");
    expect(google.last_touch.click_id).toBeUndefined();
    expect(google.last_touch.chatgpt_campaign_id).toBeUndefined();
    const otherCampaign = capture("https://www.lejapon.ma/voyages?utm_source=chatgpt&utm_campaign=sakura");
    expect(otherCampaign.last_touch.click_id).toBeUndefined();
    expect(otherCampaign.last_touch.chatgpt_campaign_id).toBeUndefined();
  });

  it("creates first touch once and updates last touch for a new real acquisition", () => {
    capture("https://www.lejapon.ma/voyages?utm_source=ig&utm_campaign=sakura");
    const result = capture("https://www.lejapon.ma/reserver?utm_source=google&utm_medium=cpc&utm_campaign=brand", "https://www.google.com/", "2026-09-28T11:00:00.000Z");
    expect(result.first_touch.source_normalized).toBe("instagram");
    expect(result.last_touch.source_normalized).toBe("google");
    expect(result.last_touch.utm_campaign).toBe("brand");
  });

  it("does not overwrite attribution on direct, reload or internal SPA navigation", () => {
    const first = capture("https://www.lejapon.ma/voyages?utm_source=facebook&utm_campaign=autumn");
    capture("https://www.lejapon.ma/programme", "https://www.lejapon.ma/voyages", "2026-09-28T12:00:00.000Z");
    const stored = readStoredAttribution(localStorage);
    expect(stored).toEqual(first);
  });

  it("captures fbclid, gclid and Meta cookies without PII", () => {
    const result = capture("https://www.lejapon.ma/voyages?fbclid=fb-click&gclid=google-click");
    expect(result.last_touch).toMatchObject({ fbclid: "fb-click", gclid: "google-click", fbp: "fb.1.123.abc", fbc: "fb.1.123.click" });
    expect(JSON.stringify(result)).not.toMatch(/email|phone|name/i);
  });

  it("persists a direct first touch when no acquisition exists yet", () => {
    const result = capture("https://www.lejapon.ma/");
    expect(result.first_touch.source_normalized).toBe("direct");
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeTruthy();
  });

  it("removes opaque references from the visible URL only after capture", () => {
    window.history.replaceState({}, "", "/reserver?utm_source=chatgpt&oppref=opaque%2Fexact&click_id=fallback");
    captureAttribution({ url: window.location.href, storage: localStorage });
    stripOpaqueAttributionFromCurrentUrl();
    expect(window.location.search).toBe("?utm_source=chatgpt");
    expect(readStoredAttribution(localStorage)?.last_touch.oppref).toBe("opaque%2Fexact");
  });

  it("drops unknown localStorage fields and never truncates an oversized opaque reference", () => {
    const touch = {
      captured_at: "2026-09-28T10:00:00.000Z",
      source_original: "chatgpt",
      source_normalized: "chatgpt_paid",
      landing_path: "/reserver",
      oppref: "x".repeat(2_001),
      email: "private@example.com",
    };
    localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify({ version: 1, first_touch: touch, last_touch: touch }));
    const stored = readStoredAttribution(localStorage);
    expect(stored?.first_touch.oppref).toBeUndefined();
    expect(stored?.first_touch).not.toHaveProperty("email");
  });
});
