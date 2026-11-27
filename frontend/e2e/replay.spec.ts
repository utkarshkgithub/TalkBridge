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
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your code. A clearer signal." }),
  ).toBeVisible();
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
  });
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Understand the review pipeline." }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByLabel("Stage latency chart"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
