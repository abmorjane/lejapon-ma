import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Seo } from "./Seo";

const canonical = () => document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
const robots = () => document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content;

afterEach(() => {
  document.head.querySelectorAll('link[rel="canonical"], meta[name="robots"]').forEach((node) => node.remove());
});

describe("SEO routing safeguards", () => {
  it("normalizes trailing slashes and strips query/hash values from canonicals", async () => {
    render(
      <MemoryRouter initialEntries={["/voyages/?campaign=test#offers"]}>
        <Seo title="Voyages" description="Voyages au Japon" />
      </MemoryRouter>,
    );

    await waitFor(() => expect(canonical()).toBe("https://www.lejapon.ma/voyages"));
  });

  it("maps legacy canonicals to the fixed official URL", async () => {
    render(
      <MemoryRouter initialEntries={["/prix"]}>
        <Seo title="Prix" description="Ancienne route" canonical="/prix/" />
      </MemoryRouter>,
    );

    await waitFor(() => expect(canonical()).toBe("https://www.lejapon.ma/reserver"));
  });

  it("supports noindex,follow without forcing nofollow", async () => {
    render(
      <MemoryRouter initialEntries={["/en/blog"]}>
        <Seo title="Blog" description="Untranslated blog" robots="noindex,follow" />
      </MemoryRouter>,
    );

    await waitFor(() => expect(robots()).toBe("noindex,follow"));
  });
});
