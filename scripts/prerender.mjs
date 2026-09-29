import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer";
import {
  formatBytes,
  manifestPath,
  projectRoot,
  readJson,
  routeToOutputFile,
} from "./seo/lib.mjs";

const HOST = "127.0.0.1";
const PORT = 4178;
const localOrigin = `http://${HOST}:${PORT}`;
const viteBinary = path.join(projectRoot, "node_modules/vite/bin/vite.js");
const manifest = await readJson(manifestPath);
const analyticsHostPattern = /(^|\.)(google-analytics\.com|googletagmanager\.com|clarity\.ms|facebook\.com|connect\.facebook\.net|openai\.com)$/i;
const analyticsRequests = [];

const isAnalyticsRequest = (requestUrl) => {
  try {
    return analyticsHostPattern.test(new URL(requestUrl).hostname);
  } catch {
    return false;
  }
};

const waitForPreview = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(localOrigin);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Vite preview did not start within 30 seconds.");
};

const preview = spawn(process.execPath, [viteBinary, "preview", "--host", HOST, "--port", String(PORT), "--strictPort"], {
  cwd: projectRoot,
  env: { ...process.env, NO_COLOR: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let previewOutput = "";
preview.stdout.on("data", (chunk) => { previewOutput += chunk.toString(); });
preview.stderr.on("data", (chunk) => { previewOutput += chunk.toString(); });

let browser;
try {
  await waitForPreview();
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const results = [];
  for (const route of manifest.prerenderRoutes) {
    // A fresh page prevents a late SPA navigation from detaching the frame
    // while the next route is being snapshotted.
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.__LEJAPON_PRERENDER__ = true;
    });
    await page.setBypassServiceWorker(true);
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (isAnalyticsRequest(request.url())) {
        analyticsRequests.push(request.url());
        request.abort();
      }
      else if (["image", "media", "font"].includes(request.resourceType())) request.abort();
      else request.continue();
    });

    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    const response = await page.goto(`${localOrigin}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response?.ok()) throw new Error(`Prerender navigation failed for ${route}: HTTP ${response?.status() ?? "unknown"}`);

    await page.waitForFunction(
      () => document.documentElement.dataset.prerenderReady === "true",
      { timeout: 20_000 },
    );
    await page.waitForFunction(
      () => {
        const h1 = document.querySelector("h1")?.textContent?.trim();
        const description = document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim();
        const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim();
        const robots = document.querySelector('meta[name="robots"]')?.getAttribute("content")?.trim();
        return Boolean(h1 && description && canonical && robots && document.title.trim());
      },
      { timeout: 10_000 },
    );
    await page.waitForNetworkIdle({ idleTime: 250, timeout: 5_000 }).catch(() => undefined);

    const snapshot = await page.evaluate((expectedRoute) => {
      const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "";
      const robots = document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";
      const description = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
      const h1 = document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const canonicalPath = canonical ? new URL(canonical).pathname.replace(/\/+$/, "") || "/" : "";
      const normalizedExpected = expectedRoute.replace(/\/+$/, "") || "/";
      if (canonicalPath !== normalizedExpected) throw new Error(`Canonical mismatch: ${canonicalPath} !== ${normalizedExpected}`);
      if (robots.replace(/\s+/g, "") !== "index,follow") throw new Error(`Unexpected robots directive: ${robots}`);
      const root = document.getElementById("root");
      if (!root || (root.textContent?.replace(/\s+/g, " ").trim().length ?? 0) < 80) {
        throw new Error("Rendered body content is missing or too short.");
      }
      root.dataset.prerendered = "true";
      return {
        title: document.title,
        description,
        canonical,
        robots,
        h1,
        lang: document.documentElement.lang,
        dir: document.documentElement.dir || "ltr",
        bodyTextLength: root.textContent?.replace(/\s+/g, " ").trim().length ?? 0,
        jsonLdCount: document.querySelectorAll('script[type="application/ld+json"]').length,
      };
    }, route);

    const relevantErrors = browserErrors.filter(
      (message) => !/Failed to load resource: net::ERR_FAILED/.test(message) && !/favicon/i.test(message),
    );
    if (relevantErrors.length) throw new Error(`Browser errors while prerendering ${route}:\n${relevantErrors.join("\n")}`);

    const html = await page.content();
    const outputFile = routeToOutputFile(route);
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.writeFile(outputFile, html, "utf8");
    results.push({ route, outputFile: path.relative(projectRoot, outputFile), bytes: Buffer.byteLength(html), ...snapshot });
    console.log(`Prerendered ${route} -> ${path.relative(projectRoot, outputFile)} (${formatBytes(Buffer.byteLength(html))})`);
    await page.close();
  }

  manifest.prerenderResults = results;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (analyticsRequests.length) {
    throw new Error(`Analytics requests were attempted during prerender:\n${[...new Set(analyticsRequests)].join("\n")}`);
  }
  console.log("Prerender analytics guard: 0 external tracking requests.");

  // Boot one generated snapshot as a real client navigation. main.tsx must replace,
  // not hydrate, the SEO snapshot without React hydration errors or duplicate content.
  const verificationPage = await browser.newPage();
  await verificationPage.evaluateOnNewDocument(() => {
    window.__LEJAPON_PRERENDER__ = true;
  });
  await verificationPage.setBypassServiceWorker(true);
  const bootErrors = [];
  verificationPage.on("pageerror", (error) => bootErrors.push(error.message));
  verificationPage.on("console", (message) => {
    if (message.type() === "error") bootErrors.push(message.text());
  });
  await verificationPage.goto(`${localOrigin}/voyages`, { waitUntil: "networkidle2", timeout: 30_000 });
  await verificationPage.waitForSelector("h1", { timeout: 10_000 });
  const rootCount = await verificationPage.evaluate(() => document.querySelectorAll("#root").length);
  if (rootCount !== 1) throw new Error(`Client boot produced ${rootCount} root containers.`);
  const hydrationErrors = bootErrors.filter((message) => /hydration|did not match|server html/i.test(message));
  if (hydrationErrors.length) throw new Error(`Client boot produced hydration errors:\n${hydrationErrors.join("\n")}`);
  await verificationPage.close();
} catch (error) {
  if (previewOutput.trim()) console.error(previewOutput.trim());
  throw error;
} finally {
  if (browser) await browser.close();
  preview.kill("SIGTERM");
}

console.log(`Prerender complete: ${manifest.prerenderRoutes.length} routes.`);
