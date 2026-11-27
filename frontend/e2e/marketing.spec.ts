import { test, expect } from "@playwright/test";

test("marketing examples and shared pixel appearance controls work", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const header = page.locator(".marketing-header-cells");
  await expect(header).toBeVisible();
  await expect(header.getByRole("group", { name: "Appearance" })).toHaveCount(
    0,
  );
  const controls = page
    .locator(".footer-preferences")
    .getByRole("group", { name: "Appearance" });
  await expect(controls.getByRole("button")).toHaveCount(3);
  await controls.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(
    page
      .locator(".footer-preferences")
      .getByRole("button", { name: "Switch to light mode" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ colorScheme: "dark" });
  await controls.getByRole("button", { name: "Use system theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(
    controls.getByRole("button", { name: "Use system theme" }),
  ).toHaveAttribute("aria-pressed", "true");
  await controls.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.getByRole("tab", { name: "Logic & edge cases" }).click();
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect(
    page.getByRole("tabpanel", { name: "Logic & edge cases" }),
  ).toContainText("88/100");
  await page.getByRole("tab", { name: "Clean reviews" }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Clean reviews" }),
  ).toContainText("No findings");
  await page.getByRole("tab", { name: "Security findings" }).click();
  await page.locator(".evidence-section").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`talkbridge-marketing-${testInfo.project.name}.png`),
  });
  await page.locator(".review-cta").scrollIntoViewIfNeeded();
  await expect(
    page
      .locator(".review-cta")
      .getByRole("link", { name: "Start your review" }),
  ).toHaveAttribute("href", "/login");
  await page.screenshot({
    path: testInfo.outputPath(`talkbridge-cta-${testInfo.project.name}.png`),
  });
  await page.locator(".footer-stage").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`talkbridge-footer-${testInfo.project.name}.png`),
  });
  if (testInfo.project.name === "mobile") {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Open site navigation" });
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "MENU" });
    await expect(menu).toBeVisible();
    await expect.poll(async () => (await menu.boundingBox())!.y).toBe(0);
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBe(0);
    expect(bounds!.y).toBe(0);
    expect(bounds!.width).toBe(page.viewportSize()!.width);
    expect(bounds!.height).toBe(page.viewportSize()!.height);
    await expect(menu.getByRole("link", { name: "Get started" })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("talkbridge-mobile-menu.png"),
    });
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await menu.getByRole("link", { name: "Review examples" }).click();
    await expect(menu).not.toBeVisible();
    await expect(page).toHaveURL(/#review-preview$/);
    await expect
      .poll(
        async () => (await page.locator("#review-preview").boundingBox())!.y,
      )
      .toBeLessThan(100);
    await page.goto("/");
    await trigger.click();
    await page.getByRole("button", { name: "Close site navigation" }).click();
    await expect(menu).not.toBeVisible();
  }
  expect(errors).toEqual([]);
});
