// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadSite() {
  vi.resetModules();
  return (await import("@/lib/site")).site;
}

afterEach(() => vi.unstubAllEnvs());

describe("public crawl policy", () => {
  it("indexes only a configured public production origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "https://talkbridge.example/product?preview=1");
    vi.stubEnv("SITE_NOINDEX", "false");
    const site = await loadSite();
    expect(site.origin).toBe("https://talkbridge.example");
    expect(site.indexable).toBe(true);
    const sitemap = (await import("@/app/sitemap")).default();
    expect(sitemap).toEqual([{ url: "https://talkbridge.example/" }]);
    const robots = (await import("@/app/robots")).default();
    expect(robots.sitemap).toBe("https://talkbridge.example/sitemap.xml");
  });

  it("keeps preview, development, and localhost out of the index", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "https://preview.example");
    vi.stubEnv("SITE_NOINDEX", "true");
    expect((await loadSite()).indexable).toBe(false);
    expect((await import("@/app/sitemap")).default()).toEqual([]);
    expect((await import("@/app/robots")).default().rules).toEqual({
      userAgent: "*",
      disallow: "/",
    });
    vi.stubEnv("SITE_NOINDEX", "false");
    vi.stubEnv("NODE_ENV", "development");
    expect((await loadSite()).indexable).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    expect((await loadSite()).indexable).toBe(false);
  });

  it("falls back to the configured auth origin without inventing a public domain", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("AUTH_URL", "https://workspace.example");
    vi.stubEnv("SITE_NOINDEX", "false");
    expect((await loadSite()).origin).toBe("https://workspace.example");
    vi.stubEnv("AUTH_URL", "");
    expect((await loadSite()).indexable).toBe(false);
  });

  it("rejects unsafe canonical origins", async () => {
    vi.stubEnv("SITE_URL", "javascript:alert(1)");
    await expect(loadSite()).rejects.toThrow("HTTP(S) origin");
    vi.stubEnv("SITE_URL", "https://user:secret@example.com");
    await expect(loadSite()).rejects.toThrow("without credentials");
  });
});
