import { expect, test } from "@playwright/test";

test("Tastatur, Live-Status und 320px-Viewport bleiben verwendbar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");

  const resultSummary = page.locator("#result-summary");
  await expect(resultSummary).toHaveText("12 von 12 Teammitgliedern angezeigt");
  await expect(resultSummary).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#selected-members")).toHaveAttribute(
    "aria-live",
    "polite",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const search = page.getByRole("searchbox", { name: "Team durchsuchen" });
  await search.focus();
  await page.keyboard.press("Tab");
  const firstFilter = page.locator('#expertise-filters input[type="checkbox"]').first();
  await expect(firstFilter).toBeFocused();
  await page.keyboard.press("Space");
  await expect(firstFilter).toBeChecked();

  await page.getByRole("button", { name: "Filter und Suche zurücksetzen" }).click();
  await expect(search).toBeFocused();

  for (let selected = 0; selected < 4; selected += 1) {
    const add = page.getByRole("button", {
      name: "Zur Arbeitszelle hinzufügen",
    }).first();
    await add.click();
    await expect(
      page.getByRole("button", { name: "Aus Arbeitszelle entfernen" }).nth(selected),
    ).toBeFocused();
  }

  await expect(page.locator("#cell-count")).toHaveText("4 von 4 gewählt");
  await expect(page.locator("#cell-limit-message")).toBeVisible();
  const blockedAdd = page
    .getByRole("button", { name: "Zur Arbeitszelle hinzufügen" })
    .first();
  await expect(blockedAdd).toBeDisabled();
  await expect(blockedAdd).toHaveAttribute(
    "aria-describedby",
    "cell-limit-message",
  );
});
