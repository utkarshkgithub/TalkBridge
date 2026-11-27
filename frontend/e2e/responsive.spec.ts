import { test, expect } from "@playwright/test";

test("all screens fit phone, tablet, and desktop widths", async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The matrix explicitly sets each viewport.",
  );
  test.setTimeout(180_000);
  const baseURL = process.env.BASE_URL || "http://127.0.0.1:3000";
  const viewports = [
    { name: "small-phone", width: 320, height: 720 },
    { name: "phone", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "laptop", width: 1024, height: 768 },
    { name: "desktop", width: 1440, height: 900 },
  ];
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, baseURL });
    const page = await context.newPage();
    const fits = async (screen: string) => {
      await expect
        .poll(
          () =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          { message: `${screen} overflows at ${viewport.width}px` },
        )
        .toBe(true);
    };
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Find the bugs. Keep the signal." }),
    ).toBeVisible();
    await fits("Landing");
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Sign in to TalkBridge" }),
    ).toBeVisible();
    await fits("Login");
    if (viewport.width > 700) {
      const dimensions = await page.evaluate(() => ({
        left: document.querySelector(".login-intro")!.getBoundingClientRect()
          .width,
        right: document.querySelector(".login-panel")!.getBoundingClientRect()
          .width,
        scrollHeight: document.documentElement.scrollHeight,
        height: window.innerHeight,
      }));
      expect(Math.abs(dimensions.left - dimensions.right)).toBeLessThanOrEqual(
        1,
      );
      expect(
        dimensions.scrollHeight,
        `Login scrolls at ${viewport.width} × ${viewport.height}`,
      ).toBeLessThanOrEqual(dimensions.height);
    }
    await page.screenshot({
      path: testInfo.outputPath(`${viewport.name}-login.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Fill test credentials" }).click();
    await page
      .getByRole("button", { name: "Sign in with test account" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Workspace overview" }),
    ).toBeVisible();
    await fits("Dashboard");
    for (const [path, heading] of [
      ["/reviews", "All reviews"],
      ["/reviews/demo-auth_sqli_pr", "Add passwordless session login"],
      ["/insights", "Pipeline insights"],
      ["/connections", "Connections"],
      ["/workflow", "Review pipeline"],
      ["/unknown-responsive-page", "This branch leads nowhere."],
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
      await fits(path);
      if (viewport.width <= 390)
        await page.screenshot({
          path: testInfo.outputPath(
            `${viewport.name}-${path.replaceAll("/", "-")}.png`,
          ),
          fullPage: true,
          animations: "disabled",
        });
    }
    await context.close();
  }
});
