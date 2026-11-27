import { test, expect } from "@playwright/test";

test("offline replay, keyboard confidence, patches and responsive navigation", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost"
      ? route.continue()
      : route.abort();
  });
  const anonymous = await page.request.get("/api/backend/reviews");
  expect(anonymous.status()).toBe(401);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Find the bugs. Keep the signal." }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("landing.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("link", { name: "Open your workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to TalkBridge" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("login.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Fill test credentials" }).click();
  await page.getByRole("button", { name: "Sign in with test account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Switch to dark mode" }),
  ).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.screenshot({
    path: testInfo.outputPath("overview-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("overview.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Replay review", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Add passwordless session login" }),
  ).toBeVisible();
  await expect(page.getByText("Recorded demo review.")).toBeVisible();
  await expect(page.getByTestId("finding-card")).toHaveCount(1);
  const slider = page.getByRole("slider", { name: "Confidence threshold" });
  await expect(slider).toBeVisible();
  let requests = 0;
  const track = (request: { url(): string }) => {
    if (request.url().includes("/api/backend")) requests++;
  };
  page.on("request", track);
  await slider.focus();
  for (let i = 0; i < 25; i++) await slider.press("ArrowLeft");
  await expect(page.getByTestId("finding-card")).toHaveCount(2);
  for (let i = 0; i < 30; i++) await slider.press("ArrowRight");
  await expect(page.getByTestId("finding-card")).toHaveCount(1);
  await page.getByText("Suggested patch", { exact: true }).click();
  await expect(page.locator(".patch-details pre")).toContainText(
    "cursor.execute",
  );
  expect(requests).toBe(0);
  page.off("request", track);
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("review.png"),
    fullPage: true,
    animations: "disabled",
  });
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pipeline insights" }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByLabel("Stage latency chart"),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("insights.png"),
    fullPage: true,
    animations: "disabled",
  });
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Connections", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connections", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No repositories connected" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("connections.png"),
    fullPage: true,
    animations: "disabled",
  });
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Pipeline", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review pipeline", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Review pipeline flow" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("pipeline.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/backend/reviews")).status()).toBe(401);
  await page.goto("/page-that-does-not-exist");
  await expect(
    page.getByRole("heading", { name: "This branch leads nowhere." }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("404.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("authenticated page loads do not prerender session expiry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /prerender|Blocking Route|unstable value/.test(message.text())
    )
      errors.push(message.text());
  });
  // Keep browser caching enabled so Next.js exercises its prerender path.
  const response = await page.request.post("/api/auth/demo", {
    headers: {
      origin: new URL(process.env.BASE_URL || "http://127.0.0.1:3000").origin,
    },
    form: { email: "demo@talkbridge.local", password: "TalkBridgeDemo!2026" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  await page.goto("/connections");
  await expect(
    page.getByRole("heading", { name: "Connections", exact: true }),
  ).toBeVisible();
  await page.goto("/login");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
