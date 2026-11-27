import { test, expect } from "@playwright/test";

test("workspace shell survives navigation and pipeline loading", async ({
  page,
}, testInfo) => {
  const hydrationErrors: string[] = [];
  page.on("pageerror", (error) => hydrationErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|didn't match|server rendered HTML/i.test(message.text())
    )
      hydrationErrors.push(message.text());
  });
  const origin = new URL(process.env.BASE_URL || "http://127.0.0.1:3000")
    .origin;
  const login = await page.request.post("/api/auth/demo", {
    headers: { origin },
    form: { email: "demo@talkbridge.local", password: "TalkBridgeDemo!2026" },
    maxRedirects: 0,
  });
  expect(login.status()).toBe(303);
  const html = await (await page.request.get("/dashboard")).text();
  expect(html).toContain("workspace-trigger");
  expect(html).not.toContain('aria-haspopup="listbox" aria-label="Workspace"');
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  const sidebar = page.locator("#dashboard-navigation");
  await sidebar.evaluate((node) =>
    node.setAttribute("data-persistence-check", "retained"),
  );
  let documents = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.resourceType() === "document")
      documents++;
  });
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Workspace menu" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.getByRole("menuitem", { name: "Manage connections" }).click();
  await expect(
    page.getByRole("heading", { name: "Connections", exact: true }),
  ).toBeVisible();
  await expect(sidebar).toHaveAttribute("data-persistence-check", "retained");
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/backend\/reviews\?/, async (route) => {
    await ready;
    await route.continue();
  });
  try {
    if (testInfo.project.name === "mobile")
      await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("link", { name: "Pipeline", exact: true }).click();
    await expect(
      page.getByRole("status", { name: "Loading pipeline" }),
    ).toBeVisible();
    await expect(sidebar).toHaveAttribute("data-persistence-check", "retained");
    await expect(page.locator(".dashboard-topbar")).toBeVisible();
    release();
    await expect(
      page.getByRole("heading", { name: "Review pipeline", exact: true }),
    ).toBeVisible();
    await expect(sidebar).toHaveAttribute("data-persistence-check", "retained");
    expect(documents).toBe(0);
    expect(hydrationErrors).toEqual([]);
  } finally {
    release();
  }
});
