import { describe, expect, it } from "vitest";
import {
  canonicalRouteSlug,
  normalizeRouteSlug,
  pathFor,
  type RouteSlug,
} from "./useRouteSlugs";

const staleProductionRow: RouteSlug = {
  route_key: "trips",
  label: "Voyages",
  slug: "prix",
  default_slug: "voyages",
  is_editable: true,
  sort_order: 1,
};

describe("canonical route slug protection", () => {
  it("ignores a divergent route_slugs value", () => {
    const normalized = normalizeRouteSlug(staleProductionRow);

    expect(normalized.slug).toBe("voyages");
    expect(normalized.is_editable).toBe(false);
    expect(canonicalRouteSlug("booking")).toBe("reserver");
  });

  it("always returns the official path even when the supplied map is stale", () => {
    const staleMap = { trips: staleProductionRow } as Parameters<typeof pathFor>[0];
    expect(pathFor(staleMap, "trips")).toBe("/voyages");
  });
});
