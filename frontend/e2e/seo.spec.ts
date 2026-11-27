import { test, expect } from "@playwright/test";

test("public content and metadata work without JavaScript for crawlers", async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Crawler checks do not depend on viewport.",
  );
  const context = await browser.newContext({
    baseURL: process.env.BASE_URL || "http://127.0.0.1:3000",
    javaScriptEnabled: false,
    userAgent: "Googlebot",
  });
  try {
    const page = await context.newPage();
    const response = await page.goto("/");
    expect(response!.status()).toBe(200);
    await expect(page).toHaveTitle(
      "TalkBridge | Evidence-backed AI code reviews",
    );
    await expect(
      page.getByRole("heading", { name: "Find the bugs. Keep the signal." }),
    ).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /^https?:\/\/[^/]+\/?$/,
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      /\/og-image\.png$/,
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    const graph = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').textContent())!,
    );
    expect(
      graph["@graph"].map((item: { "@type": string }) => item["@type"]),
    ).toEqual(["WebSite", "WebApplication"]);
    const preview = await page.request.get("/og-image.png");
    expect(preview.status()).toBe(200);
    expect(preview.headers()["content-type"]).toContain("image/png");
    expect((await page.request.get("/robots.txt")).status()).toBe(200);
    expect((await page.request.get("/sitemap.xml")).status()).toBe(200);
    const summary = await page.request.get("/llms.txt");
    expect(await summary.text()).toContain(
      "Automated pull request reviews currently use a separately configured GitHub App.",
    );
    expect(summary.headers()["x-robots-tag"]).toBe("noindex");
    await page.goto("/login");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    const privateResponse = await page.request.get("/api/backend/reviews");
    expect(privateResponse.status()).toBe(401);
    expect(privateResponse.headers()["x-robots-tag"]).toContain("noindex");
  } finally {
    await context.close();
  }
});
