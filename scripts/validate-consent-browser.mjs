import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

// A virtual production origin exercises the compiled gate without contacting
// marketing providers or writing to production Supabase.
const origin = "https://www.lejapon.ma";
const dist = path.resolve("dist");
const providerHosts = {
  ga: "www.googletagmanager.com",
  clarity: "www.clarity.ms",
  meta: "connect.facebook.net",
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
try {
  for (const scenario of [
    { name: "unknown", choice: null, expected: [0, 0, 0] },
    { name: "analytics only", choice: [true, false], expected: [1, 1, 0] },
    { name: "marketing only", choice: [false, true], expected: [0, 0, 1] },
    { name: "accept all", choice: [true, true], expected: [1, 1, 1] },
    { name: "reject all", choice: [false, false], expected: [0, 0, 0] },
  ]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: scenario.name === "unknown" ? 390 : 1440, height: 900 });
    const requests = { ga: 0, clarity: 0, meta: 0 };
    const providerRequests = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      try {
        const url = new URL(request.url());
        if (/(^|\.)(google-analytics\.com|googletagmanager\.com|clarity\.ms|facebook\.com)$/.test(url.hostname)) {
          providerRequests.push(url.hostname);
        }
        const provider = Object.entries(providerHosts).find(([, host]) => url.hostname === host)?.[0];
        if (provider) {
          requests[provider]++;
          await request.respond({ status: 200, contentType: "application/javascript", body: "" });
          return;
        }
        if (url.origin !== origin) {
          await request.respond({ status: 200, contentType: "application/json", body: "[]" });
          return;
        }
        const filename = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${dist}${path.sep}`) && filename !== dist) throw Error("Unexpected path");
        const target = (await fs.stat(filename).catch(() => null))?.isFile()
          ? filename
          : path.join(filename, "index.html");
        const body = await fs.readFile(target);
        const ext = path.extname(target);
        const contentType = ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" })[ext] ?? "application/octet-stream";
        await request.respond({ status: 200, contentType, body });
      } catch {
        if (!request.isInterceptResolutionHandled()) await request.respond({ status: 404, body: "Not found" });
      }
    });

    await page.goto(`${origin}/voyages`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("aside[aria-label] button", { timeout: 20_000 });
    if (scenario.name === "unknown") {
      const fitsMobile = await page.$eval("aside[aria-label]", (banner) => {
        const box = banner.getBoundingClientRect();
        return box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight;
      });
      if (!fitsMobile) throw Error("CMP banner does not fit the 390px mobile viewport");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    const count = () => [requests.ga, requests.clarity, requests.meta];
    if (providerRequests.length) throw Error(`${scenario.name}: provider contacted before consent: ${providerRequests.join(", ")}`);
    if (scenario.choice) {
      if (scenario.name === "reject all" || scenario.name === "accept all") {
        await page.evaluate((label) => [...document.querySelectorAll("aside button")].find((button) => button.textContent?.trim() === label)?.click(), scenario.name === "reject all" ? "Tout refuser" : "Tout accepter");
      } else {
        await page.evaluate(() => [...document.querySelectorAll("aside button")].find((button) => button.textContent?.trim() === "Personnaliser")?.click());
        await page.waitForSelector("[role=dialog]");
        if (scenario.choice[0]) await page.click("#cmp-analytics");
        if (scenario.choice[1]) await page.click("#cmp-marketing");
        await page.evaluate(() => [...document.querySelectorAll("[role=dialog] button")].find((button) => button.textContent?.trim() === "Enregistrer mes choix")?.click());
      }
      await page.waitForFunction((expected) => {
        const loaded = [Boolean(document.querySelector("#lejapon-ga4-script")), Boolean(document.querySelector("#lejapon-clarity-script")), Boolean(document.querySelector("#lejapon-meta-pixel-script"))];
        return loaded.every((value, index) => value === Boolean(expected[index]));
      }, {}, scenario.expected);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (JSON.stringify(count()) !== JSON.stringify(scenario.expected)) throw Error(`${scenario.name}: scripts ${count()} instead of ${scenario.expected}`);
    const views = await page.evaluate(() => ({
      ga: (window.dataLayer ?? []).filter((item) => Array.isArray(item) && item[1] === "page_view").length,
      meta: (window.fbq?.queue ?? []).filter((item) => Array.isArray(item) && item[1] === "PageView").length,
      stored: window.localStorage.getItem("lejapon.consent.v1"),
    }));
    if (views.ga !== scenario.expected[0] || views.meta !== scenario.expected[2]) throw Error(`${scenario.name}: page views ${JSON.stringify(views)}`);
    if (scenario.choice) {
      if (!views.stored) throw Error(`${scenario.name}: consent was not persisted`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector("#root")?.children.length > 0);
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (JSON.stringify(count()) !== JSON.stringify(scenario.expected.map((value) => value * 2))) throw Error(`${scenario.name}: refresh scripts ${count()}`);
      if (await page.$("aside[aria-label]")) throw Error(`${scenario.name}: unnecessary banner after refresh`);
      const refreshViews = await page.evaluate(() => ({
        ga: (window.dataLayer ?? []).filter((item) => Array.isArray(item) && item[1] === "page_view").length,
        meta: (window.fbq?.queue ?? []).filter((item) => Array.isArray(item) && item[1] === "PageView").length,
      }));
      if (refreshViews.ga !== scenario.expected[0] || refreshViews.meta !== scenario.expected[2]) throw Error(`${scenario.name}: duplicate refresh page view ${JSON.stringify(refreshViews)}`);
    }
    if (errors.length) throw Error(`${scenario.name}: browser errors ${errors.join(" | ")}`);
    console.log(`CMP browser ${scenario.name}: PASS (GA/Clarity/Meta ${scenario.expected.join("/")})`);
    await context.close();
  }
} finally {
  await browser.close();
}
