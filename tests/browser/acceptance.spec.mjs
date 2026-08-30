import { expect, test } from "@playwright/test";

test("Fragment-Link stellt eine Arbeitszelle wieder her und meldet Bereinigung", async ({ page }) => {
  await page.goto("/#cell=fronti,fronti,unbekannt,backendi,testihesti,desiresi,orchestoni");

  await expect(page.locator("#cell-count")).toHaveText("4 von 4 gewählt");
  await expect(page.locator("#share-status")).toHaveText(
    "Arbeitszelle mit 4 Mitgliedern wiederhergestellt. Unbekannte, doppelte oder weitere Einträge wurden ausgelassen.",
  );
  await expect(page.locator("#share-status")).toHaveAttribute("role", "status");
  await expect(page.getByRole("button", { name: "Arbeitszelle teilen" })).toBeEnabled();
});

test("Fragment-Navigation stellt Arbeitszellen wieder her und entfernt sie", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Zur Arbeitszelle hinzufügen" }).first().click();
  await page.getByRole("button", { name: "Arbeitszelle teilen" }).click();
  await expect(page).toHaveURL(/#cell=powni$/);

  await page.evaluate(() => {
    window.location.hash = "#cell=backendi,testihesti";
  });
  await expect(page.locator("#cell-count")).toHaveText("2 von 4 gewählt");
  await expect(page.locator("#selected-members")).toContainText("Backendi");
  await expect(page.locator("#selected-members")).toContainText("TestiHesti");

  await page.goBack();
  await expect(page).toHaveURL(/#cell=powni$/);
  await expect(page.locator("#cell-count")).toHaveText("1 von 4 gewählt");
  await expect(page.locator("#selected-members")).toContainText("POwni");

  await page.goBack();
  await expect(page).not.toHaveURL(/#cell=/);
  await expect(page.locator("#cell-count")).toHaveText("0 von 4 gewählt");
  await expect(page.locator("#share-status")).toHaveText(
    "Geteilte Arbeitszelle aus der Navigation entfernt.",
  );
});

test("Teilen meldet Erfolg und Clipboard-Fehler zugänglich", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Zur Arbeitszelle hinzufügen" }).first().click();
  const share = page.getByRole("button", { name: "Arbeitszelle teilen" });
  await expect(share).toBeEnabled();

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await share.click();
  await expect(page.locator("#share-status")).toHaveText("Link zur Arbeitszelle kopiert.");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("#cell=");

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("blocked")) },
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Zur Arbeitszelle hinzufügen" }).first().click();
  await page.getByRole("button", { name: "Arbeitszelle teilen" }).click();
  await expect(page.locator("#share-status")).toHaveText(
    "Link konnte nicht kopiert werden. Bitte kopiere ihn aus der Adresszeile.",
  );
  await expect(page).toHaveURL(/#cell=powni,architorti$/);
});

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

test("Missionsakte wird erstellt, über Hash fortgesetzt und vorwärts abgeschlossen", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Zur Arbeitszelle hinzufügen" }).first().click();
  await page.getByRole("button", { name: "Missionsakte erstellen" }).click();

  await page.getByLabel("Titel").fill("Release absichern");
  await page.getByLabel("Gewünschtes Ergebnis").fill("Ein überprüfbarer Release");
  await page.getByLabel("Randbedingungen").fill("Keine externen Dienste");
  await page.getByLabel("Kriterium 1").fill("Alle Prüfungen sind grün");
  await page.getByRole("button", { name: "Missionsakte anlegen" }).click();

  await expect(page).toHaveURL(/#mission=[A-Za-z0-9_-]{16,64}$/);
  await expect(page.getByRole("heading", { name: "Release absichern" })).toBeFocused();
  const missionUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(missionUrl);
  await expect(page.getByText("Status: Entwurf")).toBeVisible();
  await page.getByRole("button", { name: "Als bereit markieren" }).click();
  await expect(page.getByText("Status: Bereit", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Abschluss dokumentieren" }).click();
  await page.getByRole("button", { name: "Mission abschließen" }).click();
  await expect(page.locator(".validation-summary")).toBeFocused();
  await page.getByLabel("Kurze Abschlusszusammenfassung").fill("Release ist geprüft und freigegeben");
  await page.getByLabel("Nachweise (eine Klartextreferenz pro Zeile)").fill("PR #42\ncommit abc123");
  await page.getByRole("button", { name: "Mission abschließen" }).click();
  await expect(page.getByText("Status: Abgeschlossen", { exact: true })).toBeVisible();
  await expect(page.getByText("Release ist geprüft und freigegeben")).toBeVisible();
  await expect(page.getByText("PR #42")).toBeVisible();
  await expect(page.getByRole("button", { name: "Missionsakte bearbeiten" })).toHaveCount(0);
});

test("Tags folgen dem gemeinsamen Vertrag in Browser, Anzeige, Bearbeitung und Suche", async ({ page }) => {
  const title = `Tag-Case-${Date.now()}`;
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/#cell=deviheavy");
  await page.getByRole("button", { name: "Missionsakte erstellen" }).click();
  await page.getByLabel("Titel").fill(title);
  await page.getByLabel("Gewünschtes Ergebnis").fill("Tags ok");
  await page.getByLabel("Randbedingungen").fill("Nur");
  await page.getByLabel("Kriterium 1").fill("Test");
  const tags = page.getByLabel("Tags (eine Klartextangabe pro Zeile, optional)");
  await tags.fill("Release\nrelease");
  await page.getByRole("button", { name: "Missionsakte anlegen" }).click();
  await expect(page.locator("#mission-validation-summary")).toContainText("eindeutig ohne Unterschied bei Groß-/Kleinschreibung");
  await expect(page.locator("#mission-validation-summary")).toBeFocused();
  await expect(tags).toHaveValue("Release\nrelease");
  await tags.fill("Ä\nA\u0308");
  await page.getByRole("button", { name: "Missionsakte anlegen" }).click();
  await expect(page.locator("#mission-validation-summary")).toContainText("eindeutig ohne Unterschied bei Groß-/Kleinschreibung");
  await tags.fill("①\n1\nStraße\nİ\ni");
  await page.getByRole("button", { name: "Missionsakte anlegen" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("button", { name: "Missionsakte bearbeiten" }).click();
  await tags.fill("eins\nzwei\ndrei\nvier\nfünf\nsechs");
  await page.getByRole("button", { name: "Missionsakte speichern" }).click();
  await expect(page.locator("#mission-validation-summary")).toContainText("höchstens fünf Tags");
  await tags.fill("x".repeat(25));
  await page.getByRole("button", { name: "Missionsakte speichern" }).click();
  await expect(page.locator("#mission-validation-summary")).toContainText("höchstens 24 Zeichen je Tag");
  await tags.fill(" <b>x</b> ");
  await page.getByRole("button", { name: "Missionsakte speichern" }).click();
  await expect(page.getByText("<b>x</b>", { exact: true })).toBeVisible();
  await expect(page.locator("b")).toHaveCount(0);
  await page.getByRole("button", { name: "Missionsakte bearbeiten" }).click();
  await tags.fill("Erste Schreibweise");
  await page.getByRole("button", { name: "Missionsakte speichern" }).click();
  await expect(page.getByText("Erste Schreibweise", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Missionsakte bearbeiten" }).click();
  await tags.fill("Straße\nİ");
  await page.getByRole("button", { name: "Missionsakte speichern" }).click();
  await page.getByRole("button", { name: "Zur Missionsübersicht" }).click();
  const missionSearch = page.getByRole("searchbox", { name: "Missionen durchsuchen" });
  await missionSearch.fill("STRASSE");
  await expect(page.locator(".mission-list__item", { hasText: title })).toContainText("Straße");
  await missionSearch.fill("A\u0308");
  await expect(page.locator(".mission-list__item", { hasText: title })).toContainText("Straße");
  await missionSearch.fill("\u0308");
  await expect(page.locator(".mission-list__item")).toHaveCount(0);
  await missionSearch.fill("İ");
  await expect(page.locator(".mission-list__item", { hasText: title })).toContainText("İ");
  await missionSearch.fill("ffi");
  await expect(page.locator(".mission-list__item", { hasText: title })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Missionssuche bewahrt die diakritika-unabhängigen allgemeinen Felder", async ({ page }) => {
  const marker = Date.now().toString(36);
  const title = `Über-${marker}`;
  await page.goto("/#cell=deviheavy");
  await page.getByRole("button", { name: "Missionsakte erstellen" }).click();
  await page.getByLabel("Titel").fill(title);
  await page.getByLabel("Gewünschtes Ergebnis").fill(`Crème-${marker}`);
  await page.getByLabel("Randbedingungen").fill("Keine");
  await page.getByLabel("Tags (eine Klartextangabe pro Zeile, optional)").fill(`ﬃ-${marker}`);
  await page.getByLabel("Kriterium 1").fill("Geprüft");
  await page.getByRole("button", { name: "Missionsakte anlegen" }).click();
  await page.getByRole("button", { name: "Zur Missionsübersicht" }).click();
  const search = page.getByRole("searchbox", { name: "Missionen durchsuchen" });
  await search.fill(`uber-${marker}`);
  await expect(page.locator(".mission-list__item", { hasText: title })).toHaveCount(1);
  await search.fill(`creme-${marker}`);
  await expect(page.locator(".mission-list__item", { hasText: title })).toHaveCount(1);
  await search.fill(`ffi-${marker}`);
  await expect(page.locator(".mission-list__item", { hasText: title })).toHaveCount(0);
});

test("Missionsübersicht sucht, filtert, sortiert und öffnet per Hash", async ({ page }) => {
  const marker = `Uebersicht-${Date.now()}`;
  const tagMarker = Date.now().toString(36);
  const firstTitle = `Erste ${marker}`;
  const secondTitle = `Zweite ${marker}`;
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Missionsübersicht" })).toBeVisible();

  for (const [title, outcome] of [[firstTitle, `Alpha-${marker}`], [secondTitle, `Beta-${marker}`]]) {
    await page.getByRole("button", { name: "Zur Arbeitszelle hinzufügen" }).first().click();
    await page.getByRole("button", { name: "Missionsakte erstellen" }).click();
    await page.getByLabel("Titel").fill(title);
    await page.getByLabel("Gewünschtes Ergebnis").fill(outcome);
  await page.getByLabel("Randbedingungen").fill("Keine");
  await page.getByLabel("Tags (eine Klartextangabe pro Zeile, optional)").fill(`Fachlich-${tagMarker}\nSchnell`);
  await page.getByLabel("Kriterium 1").fill("Geprüft");
    await page.getByRole("button", { name: "Missionsakte anlegen" }).click();
    await page.getByRole("button", { name: "Zur Missionsübersicht" }).click();
  }

  const items = page.locator(".mission-list__item");
  await page.getByRole("searchbox", { name: "Missionen durchsuchen" }).fill(marker);
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText(secondTitle);
  await page.getByRole("searchbox", { name: "Missionen durchsuchen" }).fill(`Alpha-${marker}`);
  await expect(page.locator("#mission-list-summary")).toContainText("1 von");
  await expect(items).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Missionen durchsuchen" }).fill(`fachlich-${tagMarker}`);
  await expect(items).toHaveCount(2);
  await page.getByRole("searchbox", { name: "Missionen durchsuchen" }).fill(`Alpha-${marker} Fachlich-${tagMarker}`);
  await expect(items).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Missionen durchsuchen" }).fill(marker);
  await page.getByLabel("Abgeschlossen").uncheck();
  await expect(items).toHaveCount(2);
  await page.getByLabel("Entwurf").uncheck();
  await expect(page.getByText("Keine Mission passt zu Suche und Statusfilter.")).toBeVisible();
  await page.getByRole("button", { name: "Missionsfilter zurücksetzen" }).click();
  await page.getByRole("button", { name: `${secondTitle} öffnen` }).click();
  await expect(page).toHaveURL(/#mission=/);
  await expect(page.getByRole("heading", { name: secondTitle })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Missionsübersicht zeigt Kitten und sucht gemeinsam nach Name, Rolle und Status", async ({ page }) => {
  const title = `Kitten auffindbar ${Date.now()}`;
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Zur Arbeitszelle hinzufügen" }).first().click();
  await page.getByRole("button", { name: "Missionsakte erstellen" }).click();
  await page.getByLabel("Titel").fill(title);
  await page.getByLabel("Gewünschtes Ergebnis").fill("Zuordnung sichtbar");
  await page.getByLabel("Randbedingungen").fill("Keine");
  await page.getByLabel("Tags (eine Klartextangabe pro Zeile, optional)").fill("fachlich");
  await page.getByLabel("Kriterium 1").fill("Suche findet die Mission");
  await page.getByRole("button", { name: "Missionsakte anlegen" }).click();
  await page.getByRole("button", { name: "Zur Missionsübersicht" }).click();

  const item = page.locator(".mission-list__item", { hasText: title });
  await expect(item).toContainText("POwni (Produktstrategie)");
  await page.getByRole("searchbox", { name: "Missionen durchsuchen" }).fill("Produktstrategie");
  await expect(item).toBeVisible();
  await page.getByRole("searchbox", { name: "Missionen durchsuchen" }).fill("fachlich");
  await expect(item).toBeVisible();
  await page.getByLabel("Entwurf").uncheck();
  await expect(item).toHaveCount(0);
  await page.getByLabel("Entwurf").check();
  await page.getByRole("searchbox", { name: "Missionen durchsuchen" }).fill("POwni");
  await expect(item).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Missionsfilter sind per URL teilbar und folgen der Browser-Navigation", async ({ page }) => {
  const title = `Teilbar ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Zur Arbeitszelle hinzufügen" }).first().click();
  await page.getByRole("button", { name: "Missionsakte erstellen" }).click();
  await page.getByLabel("Titel").fill(title);
  await page.getByLabel("Gewünschtes Ergebnis").fill("Filter über einen Link wiederherstellen");
  await page.getByLabel("Randbedingungen").fill("Keine");
  await page.getByLabel("Kriterium 1").fill("URL enthält die Filter");
  await page.getByRole("button", { name: "Missionsakte anlegen" }).click();
  await page.getByRole("button", { name: "Zur Missionsübersicht" }).click();

  const search = page.getByRole("searchbox", { name: "Missionen durchsuchen" });
  await search.fill(title);
  await page.getByLabel("Abgeschlossen").uncheck();
  const sharedUrl = page.url();
  expect(sharedUrl).toContain("missionQuery=");
  expect(sharedUrl).toContain("missionStatus=draft%2Cready");

  await page.goto(sharedUrl);
  await expect(search).toHaveValue(title);
  await expect(page.getByLabel("Abgeschlossen")).not.toBeChecked();
  await expect(page.getByRole("button", { name: `${title} öffnen` })).toBeVisible();

  await search.fill(`${title} fehlt`);
  await expect(page.getByText("Keine Mission passt zu Suche und Statusfilter.")).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue(title);
  await expect(page.getByLabel("Abgeschlossen")).not.toBeChecked();
});

test("Mission wird erst nach bewusster Übernahme als neuer Entwurf angelegt", async ({ page }) => {
  const marker = `Kopiervorlage-${Date.now()}`;
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Zur Arbeitszelle hinzufügen" }).first().click();
  await page.getByRole("button", { name: "Zur Arbeitszelle hinzufügen" }).first().click();
  await page.getByRole("button", { name: "Missionsakte erstellen" }).click();
  await page.getByLabel("Titel").fill(marker);
  await page.getByLabel("Gewünschtes Ergebnis").fill("Kopierbares Ergebnis");
  await page.getByLabel("Randbedingungen").fill("Original unverändert lassen");
  await page.getByLabel("Kriterium 1").fill("Erstes Kriterium");
  await page.getByRole("button", { name: "Kriterium hinzufügen" }).click();
  await page.getByLabel("Kriterium 2").fill("Zweites Kriterium");
  await page.getByRole("button", { name: "Missionsakte anlegen" }).click();
  await expect(page).toHaveURL(/#mission=[A-Za-z0-9_-]{16,64}$/);

  const originalUrl = page.url();
  const originalId = new URL(originalUrl).hash.replace("#mission=", "");
  await page.getByRole("button", { name: "Als bereit markieren" }).click();
  await page.getByRole("button", { name: "Als neuen Entwurf übernehmen" }).click();
  await expect(page.getByRole("heading", { name: "Mission als neuen Entwurf übernehmen" })).toBeFocused();
  await expect(page.getByLabel("Titel")).toHaveValue(marker);
  await expect(page.getByLabel("Gewünschtes Ergebnis")).toHaveValue("Kopierbares Ergebnis");
  await expect(page.getByLabel("Randbedingungen")).toHaveValue("Original unverändert lassen");
  await expect(page.getByLabel("Kriterium 2")).toHaveValue("Zweites Kriterium");
  await page.getByRole("button", { name: "Übernahme abbrechen" }).click();
  await expect(page).toHaveURL(originalUrl);
  await expect(page.getByText("Status: Bereit", { exact: true })).toBeVisible();
  await expect(page.locator("#mission-announcer")).toHaveText("Übernahme abgebrochen. Die ursprüngliche Mission blieb unverändert.");

  await page.getByRole("button", { name: "Als neuen Entwurf übernehmen" }).click();
  await page.getByLabel("Titel").fill(`${marker} Kopie`);
  await page.getByRole("button", { name: "Neuen Entwurf anlegen" }).click();
  await expect.poll(() => new URL(page.url()).hash).not.toBe(`#mission=${originalId}`);
  await expect(page).toHaveURL(/#mission=[A-Za-z0-9_-]{16,64}$/);
  await expect(page.getByText("Status: Entwurf", { exact: true })).toBeVisible();
  await expect(page.getByText("POwni, ArchiTorti", { exact: true })).toBeVisible();
  const copyUrl = page.url();
  await page.goBack();
  await expect(page).toHaveURL(originalUrl);
  await expect(page.getByRole("heading", { name: marker })).toBeFocused();
  await expect(page.getByText("Status: Bereit", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(copyUrl);
  await expect(page.getByRole("heading", { name: `${marker} Kopie` })).toBeFocused();
  await expect(page.getByText("Status: Entwurf", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Missionsübersicht erklärt leeren und fehlerhaften Listenabruf", async ({ page }) => {
  await page.route("**/api/missions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ missions: [] }) }));
  await page.goto("/");
  await expect(page.getByText("Noch keine Missionen vorhanden.")).toBeVisible();

  await page.unroute("**/api/missions");
  await page.route("**/api/missions", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "fail" } }) }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Missionen konnten nicht geladen werden" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Missionen erneut laden" })).toBeVisible();
  await expect(page.locator("#mission-error")).toHaveAttribute("role", "alert");
});

test("Validierung erhält Eingaben; Export und zweistufiger Restore bleiben zugänglich", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Zur Arbeitszelle hinzufügen" }).first().click();
  await page.getByRole("button", { name: "Missionsakte erstellen" }).click();
  await page.getByLabel("Titel").fill("Bleibt erhalten");
  await page.getByRole("button", { name: "Missionsakte anlegen" }).click();
  await expect(page.locator("#mission-validation-summary")).toBeFocused();
  await expect(page.getByLabel("Titel")).toHaveValue("Bleibt erhalten");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Missionsakten exportieren" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("missions-v3.json");
  const exportPath = await download.path();
  await page.setInputFiles("#restore-file", exportPath);
  await page.getByRole("button", { name: "Wiederherstellung prüfen" }).click();
  await expect(page.getByRole("heading", { name: "Vorschau bereit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Geprüfte Sicherung wiederherstellen" })).toBeFocused();
  await page.getByRole("button", { name: "Geprüfte Sicherung wiederherstellen" }).click();
  await expect(page.locator("#mission-announcer")).toHaveText("Sicherung wiederhergestellt.");
});

test("Revisionskonflikt und Netzwerkfehler bewahren den lokalen Entwurf", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Zur Arbeitszelle hinzufügen" }).first().click();
  await page.getByRole("button", { name: "Missionsakte erstellen" }).click();
  await page.getByLabel("Titel").fill("Konfliktbasis");
  await page.getByLabel("Gewünschtes Ergebnis").fill("Ergebnis");
  await page.getByLabel("Randbedingungen").fill("Grenzen");
  await page.getByLabel("Kriterium 1").fill("Beweis");
  await page.getByRole("button", { name: "Missionsakte anlegen" }).click();
  await page.getByRole("button", { name: "Missionsakte bearbeiten" }).click();
  await page.getByLabel("Titel").fill("Lokaler Konfliktentwurf");
  await page.route("**/api/missions/*", async (route) => {
    if (route.request().method() === "PUT") await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "REVISION_CONFLICT", message: "conflict", details: { currentRevision: 2 } } }) });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Missionsakte speichern" }).click();
  await expect(page.locator("#mission-error")).toContainText("Deine Eingaben bleiben erhalten");
  await expect(page.getByLabel("Titel")).toHaveValue("Lokaler Konfliktentwurf");
});

test("Revisionskonflikt beim Abschluss bewahrt Zusammenfassung und Nachweis", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Zur Arbeitszelle hinzufügen" }).first().click();
  await page.getByRole("button", { name: "Missionsakte erstellen" }).click();
  await page.getByLabel("Titel").fill("Konfliktabschluss");
  await page.getByLabel("Gewünschtes Ergebnis").fill("Nachvollziehbar fertig");
  await page.getByLabel("Randbedingungen").fill("Lokal");
  await page.getByLabel("Kriterium 1").fill("Belegt");
  await page.getByRole("button", { name: "Missionsakte anlegen" }).click();
  await page.getByRole("button", { name: "Als bereit markieren" }).click();
  await page.getByRole("button", { name: "Abschluss dokumentieren" }).click();
  await page.getByLabel("Kurze Abschlusszusammenfassung").fill("Meine Abschlussangabe");
  await page.getByLabel("Nachweise (eine Klartextreferenz pro Zeile)").fill("commit deadbeef");
  await page.route("**/api/missions/*/status", (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "REVISION_CONFLICT", message: "conflict", details: { currentRevision: 3 } } }) }));
  await page.getByRole("button", { name: "Mission abschließen" }).click();
  await expect(page.locator("#mission-error")).toContainText("Abschlussangaben bleiben erhalten");
  await expect(page.getByLabel("Kurze Abschlusszusammenfassung")).toHaveValue("Meine Abschlussangabe");
  await expect(page.getByLabel("Nachweise (eine Klartextreferenz pro Zeile)")).toHaveValue("commit deadbeef");
});

test("Restore lehnt ungültige, zu große und neuere Sicherungen ohne Übernahme ab", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#restore-file", { name: "kaputt.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await page.getByRole("button", { name: "Wiederherstellung prüfen" }).click();
  await expect(page.locator("#mission-error")).toContainText("ungültig");

  await page.setInputFiles("#restore-file", { name: "gross.json", mimeType: "application/json", buffer: Buffer.alloc(128 * 1024 + 1, "x") });
  await page.getByRole("button", { name: "Wiederherstellung prüfen" }).click();
  await expect(page.locator("#mission-error")).toContainText("zu groß");

  const future = { schemaVersion: 4, storeRevision: 0, missions: [] };
  await page.setInputFiles("#restore-file", { name: "zukunft.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(future)) });
  await page.getByRole("button", { name: "Wiederherstellung prüfen" }).click();
  await expect(page.locator("#mission-error")).toContainText("nicht unterstützte neuere Version");
  await expect(page.locator("#apply-restore")).toHaveCount(0);
});
