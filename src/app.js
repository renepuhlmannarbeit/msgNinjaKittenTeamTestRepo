import {
  AppError,
  ERROR_CODES,
  MAX_CELL_SIZE,
  clearCell,
  clearDiscovery,
  filterMembers,
  listExpertise,
  restoreCell,
  serializeCell,
  toggleSelection,
  validateTeam,
} from "./domain.js";

const elements = {
  clearCell: document.querySelector("#clear-cell"),
  clearDiscovery: document.querySelector("#clear-discovery"),
  count: document.querySelector("#cell-count"),
  copyCell: document.querySelector("#copy-cell"),
  filterOptions: document.querySelector("#filter-options"),
  filters: document.querySelector("#expertise-filters"),
  limitMessage: document.querySelector("#cell-limit-message"),
  results: document.querySelector("#result-summary"),
  search: document.querySelector("#team-search"),
  selected: document.querySelector("#selected-members"),
  shareStatus: document.querySelector("#share-status"),
  team: document.querySelector("#team-region"),
  createMission: document.querySelector("#create-mission"),
  missionHint: document.querySelector("#mission-cell-hint"),
  missionRegion: document.querySelector("#mission-region"),
  missionView: document.querySelector("#mission-view"),
  missionError: document.querySelector("#mission-error"),
  missionAnnouncer: document.querySelector("#mission-announcer"),
  exportMissions: document.querySelector("#export-missions"),
  restoreFile: document.querySelector("#restore-file"),
  previewRestore: document.querySelector("#preview-restore"),
  restorePreview: document.querySelector("#restore-preview"),
};

let state = {
  status: "loading",
  members: [],
  query: "",
  activeExpertise: new Set(),
  selectedIds: new Set(),
  error: null,
};
let locallySharedHash = null;
let lastRoutedHref = window.location.href;
let missionState = { status: "board", mission: null, draft: null, preview: null, missions: [], query: "", statuses: new Set(["draft", "ready", "completed"]) };

const statusLabels = { draft: "Entwurf", ready: "Bereit", completed: "Abgeschlossen" };
const missionStatuses = ["draft", "ready", "completed"];

function restoreMissionFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const statuses = new Set((params.get("missionStatus") || "").split(",").filter((status) => missionStatuses.includes(status)));
  missionState.query = params.get("missionQuery") || "";
  missionState.statuses = statuses.size > 0 || params.has("missionStatus") ? statuses : new Set(missionStatuses);
}

function shareMissionFilters() {
  const url = new URL(window.location.href);
  const statuses = missionStatuses.filter((status) => missionState.statuses.has(status));
  if (missionState.query) url.searchParams.set("missionQuery", missionState.query);
  else url.searchParams.delete("missionQuery");
  if (statuses.length === missionStatuses.length) url.searchParams.delete("missionStatus");
  else url.searchParams.set("missionStatus", statuses.join(","));
  history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  lastRoutedHref = window.location.href;
}

async function apiRequest(path, options = {}) {
  let response;
  try { response = await fetch(path, options); }
  catch { throw { code: "NETWORK", message: "Netzwerkfehler" }; }
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();
  if (!response.ok) throw { status: response.status, ...(payload?.error || {}), message: payload?.error?.message || "Anfrage fehlgeschlagen" };
  return payload;
}

function missionInput(mission = {}) {
  return { title: mission.title || "", outcome: mission.outcome || "", constraints: mission.constraints || "", criteria: [...(mission.criteria || [""])], agentIds: [...(mission.agentIds || state.selectedIds)] };
}

function setMissionMessage(message, error = false) {
  elements.missionAnnouncer.textContent = error ? "" : message;
  elements.missionError.hidden = !error;
  elements.missionError.textContent = error ? message : "";
}

function field(labelText, id, value, tag = "input") {
  const wrapper = document.createElement("div"); wrapper.className = "mission-field";
  const label = document.createElement("label"); label.htmlFor = id; label.textContent = labelText;
  const input = document.createElement(tag); input.id = id; input.name = id; input.value = value; if (tag === "input") input.type = "text";
  wrapper.append(label, input); return { wrapper, input };
}

function renderMissionForm(input, mission = null, copySource = null) {
  missionState.draft = input;
  const form = document.createElement("form"); form.id = "mission-form"; form.className = "mission-form"; form.noValidate = true;
  const heading = text("h3", mission ? "Missionsakte bearbeiten" : copySource ? "Mission als neuen Entwurf übernehmen" : "Neue Missionsakte"); heading.tabIndex = -1;
  const summary = document.createElement("div"); summary.id = "mission-validation-summary"; summary.className = "validation-summary"; summary.tabIndex = -1; summary.hidden = true;
  const titleField = field("Titel", "mission-title-input", input.title);
  const outcomeField = field("Gewünschtes Ergebnis", "mission-outcome", input.outcome, "textarea");
  const constraintsField = field("Randbedingungen", "mission-constraints", input.constraints, "textarea");
  const criteria = document.createElement("fieldset"); criteria.id = "mission-criteria";
  criteria.append(text("legend", "Überprüfbare Akzeptanzkriterien"));
  const criteriaList = document.createElement("div"); criteriaList.className = "criteria-list";
  function drawCriteria(focusIndex) {
    criteriaList.replaceChildren();
    input.criteria.forEach((value, index) => {
      const row = document.createElement("div"); row.className = "criteria-field";
      const item = field(`Kriterium ${index + 1}`, `mission-criterion-${index}`, value);
      item.input.addEventListener("input", () => { input.criteria[index] = item.input.value; });
      row.append(item.wrapper);
      if (input.criteria.length > 1) { const remove = createButton(`Kriterium ${index + 1} entfernen`, "button button--text"); remove.addEventListener("click", () => { input.criteria.splice(index, 1); drawCriteria(Math.max(0, index - 1)); }); row.append(remove); }
      criteriaList.append(row);
    });
    add.disabled = input.criteria.length >= 5;
    if (focusIndex !== undefined) document.querySelector(`#mission-criterion-${focusIndex}`)?.focus();
  }
  const add = createButton("Kriterium hinzufügen", "button button--secondary"); add.addEventListener("click", () => { if (input.criteria.length < 5) { input.criteria.push(""); drawCriteria(input.criteria.length - 1); } });
  criteria.append(criteriaList, add); drawCriteria();
  for (const { input: control } of [titleField, outcomeField, constraintsField]) control.addEventListener("input", () => { input[control.id === "mission-title-input" ? "title" : control.id.replace("mission-", "")] = control.value; });
  const save = document.createElement("button"); save.className = "button"; save.type = "submit"; save.textContent = mission ? "Missionsakte speichern" : copySource ? "Neuen Entwurf anlegen" : "Missionsakte anlegen";
  form.append(heading);
  if (copySource) form.append(text("p", "Die Angaben sind vorausgefüllt. Erst das Anlegen erzeugt eine neue Mission; die ursprüngliche Mission bleibt unverändert.", "status-card"));
  form.append(summary, titleField.wrapper, outcomeField.wrapper, constraintsField.wrapper, criteria, save);
  if (copySource) {
    const cancel = createButton("Übernahme abbrechen", "button button--text");
    cancel.addEventListener("click", () => { missionState = { ...missionState, status: "detail", mission: copySource, draft: null }; renderMissionDetail(copySource); setMissionMessage("Übernahme abgebrochen. Die ursprüngliche Mission blieb unverändert."); });
    form.append(cancel);
  }
  form.addEventListener("submit", async (event) => { event.preventDefault(); await saveMission(form, summary, input, mission); });
  elements.missionView.replaceChildren(form); heading.focus();
}

function validateDraft(input, form, summary) {
  form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  const invalid = [];
  [["mission-title-input", input.title], ["mission-outcome", input.outcome], ["mission-constraints", input.constraints], ...input.criteria.map((value, index) => [`mission-criterion-${index}`, value])].forEach(([id, value]) => { if (!value.trim()) { form.querySelector(`#${id}`)?.setAttribute("aria-invalid", "true"); invalid.push(id); } });
  summary.hidden = invalid.length === 0; summary.textContent = invalid.length ? "Bitte korrigiere die markierten Angaben. Alle Felder und Kriterien sind erforderlich." : "";
  if (invalid.length) summary.focus(); return invalid.length === 0;
}

async function saveMission(form, summary, input, mission) {
  if (!validateDraft(input, form, summary)) return;
  missionState.status = "saving"; setMissionMessage("Missionsakte wird gespeichert …");
  try {
    const payload = mission
      ? await apiRequest(`/api/missions/${encodeURIComponent(mission.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission: input, expectedRevision: mission.revision }) })
      : await apiRequest("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    missionState = { ...missionState, status: "detail", mission: payload.mission, draft: null };
    history.pushState(null, "", `#mission=${encodeURIComponent(payload.mission.id)}`); lastRoutedHref = window.location.href; renderMissionDetail(payload.mission); setMissionMessage("Missionsakte gespeichert.");
  } catch (error) {
    missionState.status = error.code === "REVISION_CONFLICT" ? "conflict" : "editing";
    const message = error.code === "REVISION_CONFLICT" ? "Nicht gespeichert: Die Akte wurde inzwischen geändert. Deine Eingaben bleiben erhalten. Lade die Akte neu, um zu vergleichen." : error.status === 413 ? "Die Eingabe ist zu groß und wurde nicht gespeichert." : "Die Änderung konnte nicht gespeichert werden. Deine Eingaben bleiben erhalten; bitte versuche es erneut.";
    setMissionMessage(message, true); form.querySelector("button[type=submit]")?.focus();
  }
}

function renderMissionDetail(mission) {
  const box = document.createElement("article"); box.className = "mission-detail";
  const heading = text("h3", mission.title); heading.id = "mission-title"; heading.tabIndex = -1;
  const agents = mission.agentIds.map((id) => state.members.find((member) => member.id === id)?.name || id);
  const list = document.createElement("ol"); mission.criteria.forEach((item) => list.append(text("li", item)));
  box.append(heading, text("p", `Status: ${statusLabels[mission.status]}`, "mission-status"), text("p", `Version ${mission.revision}`, "mission-meta"), text("h4", "Geplantes Ergebnis"), text("p", mission.outcome), text("h4", "Arbeitszelle"), text("p", agents.join(", ")), text("h4", "Akzeptanzkriterien"), list, text("h4", "Randbedingungen"), text("p", mission.constraints));
  if (mission.status === "completed") {
    box.append(text("h4", "Tatsächlicher Abschluss"));
    if (mission.completion) {
      box.append(text("p", mission.completion.summary), text("h4", "Nachweise"));
      const evidence = document.createElement("ul"); mission.completion.evidence.forEach((item) => evidence.append(text("li", item))); box.append(evidence);
    } else {
      box.append(text("p", "Für diese aus Schema v1 übernommene Akte wurden keine Abschlussangaben erfasst.", "status-card"));
    }
  }
  const actions = document.createElement("div"); actions.className = "mission-actions";
  if (mission.status !== "completed") { const edit = createButton("Missionsakte bearbeiten"); edit.addEventListener("click", () => renderMissionForm(missionInput(mission), mission)); actions.append(edit); const next = mission.status === "draft" ? "ready" : "completed"; const transition = createButton(next === "ready" ? "Als bereit markieren" : "Abschluss dokumentieren", "button button--secondary"); transition.addEventListener("click", () => next === "completed" ? renderCompletionForm(mission) : transitionMission(mission, next)); actions.append(transition); }
  const copy = createButton("Als neuen Entwurf übernehmen", "button button--secondary"); copy.addEventListener("click", () => { missionState.status = "copying"; renderMissionForm(missionInput(mission), null, mission); }); actions.append(copy);
  const board = createButton("Zur Missionsübersicht", "button button--text"); board.addEventListener("click", () => { history.pushState(null, "", location.pathname + location.search); lastRoutedHref = window.location.href; missionState = { ...missionState, status: "board", mission: null, draft: null }; renderMissionOverview({ focus: true }); }); actions.append(board);
  box.append(actions); elements.missionView.replaceChildren(box); heading.focus();
}

function renderCompletionForm(mission, completion = { summary: "", evidenceText: "" }) {
  const form = document.createElement("form"); form.className = "mission-form"; form.noValidate = true;
  const heading = text("h3", "Missionsabschluss dokumentieren"); heading.tabIndex = -1;
  const planned = text("p", mission.outcome); const summary = document.createElement("div"); summary.className = "validation-summary"; summary.tabIndex = -1; summary.hidden = true;
  const resultField = field("Kurze Abschlusszusammenfassung", "completion-summary", completion.summary, "textarea");
  const evidenceField = field("Nachweise (eine Klartextreferenz pro Zeile)", "completion-evidence", completion.evidenceText, "textarea");
  resultField.input.addEventListener("input", () => { completion.summary = resultField.input.value; });
  evidenceField.input.addEventListener("input", () => { completion.evidenceText = evidenceField.input.value; });
  const submit = document.createElement("button"); submit.type = "submit"; submit.className = "button"; submit.textContent = "Mission abschließen";
  const cancel = createButton("Zur Missionsakte", "button button--text"); cancel.addEventListener("click", () => renderMissionDetail(mission));
  form.append(heading, text("h4", "Geplantes Ergebnis"), planned, summary, resultField.wrapper, evidenceField.wrapper, submit, cancel);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const evidence = completion.evidenceText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
    const invalid = []; if (!completion.summary.trim()) invalid.push(resultField.input); if (evidence.length < 1 || evidence.length > 5) invalid.push(evidenceField.input);
    invalid.forEach((node) => node.setAttribute("aria-invalid", "true")); summary.hidden = invalid.length === 0;
    summary.textContent = invalid.length ? "Ergänze eine kurze Zusammenfassung und ein bis fünf Nachweise, jeweils eine Referenz pro Zeile." : "";
    if (invalid.length) { summary.focus(); return; }
    await transitionMission(mission, "completed", { summary: completion.summary, evidence }, { form, completion });
  });
  elements.missionView.replaceChildren(form); heading.focus();
}

async function transitionMission(mission, status, completion = null, context = {}) {
  try { const payload = await apiRequest(`/api/missions/${encodeURIComponent(mission.id)}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, expectedRevision: mission.revision, ...(completion ? { completion } : {}) }) }); missionState.mission = payload.mission; renderMissionDetail(payload.mission); setMissionMessage(`Status: ${statusLabels[status]}.`); }
  catch (error) {
    const message = error.code === "REVISION_CONFLICT" ? "Status nicht geändert: Die Akte wurde inzwischen geändert. Deine Abschlussangaben bleiben erhalten; lade die Akte neu, bevor du es erneut versuchst." : "Der Status konnte nicht geändert werden. Deine Eingaben bleiben erhalten.";
    setMissionMessage(message, true); (context.form?.querySelector("button[type=submit]") || document.activeElement)?.focus();
  }
}

function normalizedMissionQuery(value) {
  return value.trim().toLocaleLowerCase("de").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function filteredMissions() {
  const query = normalizedMissionQuery(missionState.query);
  return missionState.missions.filter((mission) => {
    const haystack = normalizedMissionQuery(`${mission.title} ${mission.outcome} ${mission.agents.map(({ name, role }) => `${name} ${role}`).join(" ")}`);
    return missionState.statuses.has(mission.status) && (!query || haystack.includes(query));
  });
}

function drawMissionOverview({ focus = false } = {}) {
  const section = document.createElement("section"); section.className = "mission-overview"; section.setAttribute("aria-labelledby", "mission-overview-title");
  const heading = text("h3", "Missionsübersicht"); heading.id = "mission-overview-title"; heading.tabIndex = -1;
  const controls = document.createElement("div"); controls.className = "mission-overview__controls";
  const searchField = field("Missionen durchsuchen", "mission-search", missionState.query); searchField.input.type = "search"; searchField.input.placeholder = "Titel, Ergebnis, Kitten oder Rolle";
  searchField.input.addEventListener("input", () => { missionState.query = searchField.input.value; shareMissionFilters(); drawMissionOverview(); document.querySelector("#mission-search")?.focus(); });
  const filters = document.createElement("fieldset"); filters.className = "filters"; filters.append(text("legend", "Status filtern"));
  const options = document.createElement("div"); options.className = "filter-options";
  for (const status of missionStatuses) {
    const label = document.createElement("label"); label.className = "filter";
    const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = status; checkbox.checked = missionState.statuses.has(status);
    checkbox.addEventListener("change", () => { if (checkbox.checked) missionState.statuses.add(status); else missionState.statuses.delete(status); shareMissionFilters(); drawMissionOverview(); document.querySelector(`input[value="${status}"]`)?.focus(); });
    label.append(checkbox, text("span", statusLabels[status])); options.append(label);
  }
  filters.append(options); controls.append(searchField.wrapper, filters);
  const shown = filteredMissions();
  const summary = text("p", `${shown.length} von ${missionState.missions.length} Missionen angezeigt`, "results-heading"); summary.id = "mission-list-summary"; summary.setAttribute("role", "status"); summary.setAttribute("aria-live", "polite");
  const listRegion = document.createElement("div"); listRegion.id = "mission-list";
  if (missionState.missions.length === 0) {
    listRegion.append(text("p", "Noch keine Missionen vorhanden. Erstelle eine Missionsakte aus einer Arbeitszelle.", "status-card"));
  } else if (shown.length === 0) {
    const empty = text("p", "Keine Mission passt zu Suche und Statusfilter.", "status-card");
    const reset = createButton("Missionsfilter zurücksetzen", "button button--secondary"); reset.addEventListener("click", () => { missionState.query = ""; missionState.statuses = new Set(missionStatuses); shareMissionFilters(); drawMissionOverview({ focus: true }); });
    listRegion.append(empty, reset);
  } else {
    const list = document.createElement("ul"); list.className = "mission-list";
    for (const mission of shown) {
      const item = document.createElement("li"); item.className = "mission-list__item";
      const title = text("h4", mission.title); const outcome = text("p", mission.outcome);
      const agents = text("p", `Kitten: ${mission.agents.map(({ name, role }) => `${name} (${role})`).join(", ")}`, "mission-agents");
      const status = text("p", `Status: ${statusLabels[mission.status]}`, "mission-status");
      const updated = text("p", `Aktualisiert: ${new Intl.DateTimeFormat("de", { dateStyle: "medium", timeStyle: "short" }).format(new Date(mission.updatedAt))}`, "mission-meta");
      const open = createButton(`${mission.title} öffnen`, "button button--secondary"); open.addEventListener("click", () => { location.hash = `mission=${encodeURIComponent(mission.id)}`; });
      item.append(title, outcome, agents, status, updated, open); list.append(item);
    }
    listRegion.append(list);
  }
  section.append(heading, controls, summary, listRegion); elements.missionView.replaceChildren(section); setMissionMessage(""); if (focus) heading.focus();
}

async function renderMissionOverview({ focus = false } = {}) {
  missionState.status = "loading"; elements.missionRegion.setAttribute("aria-busy", "true");
  elements.missionView.replaceChildren(text("p", "Missionen werden geladen …", "status-card")); setMissionMessage("");
  try {
    const payload = await apiRequest("/api/missions"); missionState = { ...missionState, status: "board", missions: payload.missions }; drawMissionOverview({ focus });
  } catch {
    missionState.status = "error";
    const card = document.createElement("section"); card.className = "status-card status-card--error"; const heading = text("h3", "Missionen konnten nicht geladen werden"); heading.tabIndex = -1;
    const retry = createButton("Missionen erneut laden"); retry.addEventListener("click", () => renderMissionOverview({ focus: true })); card.append(heading, text("p", "Bitte versuche es erneut."), retry); elements.missionView.replaceChildren(card); setMissionMessage("Missionen konnten nicht geladen werden.", true); if (focus) heading.focus();
  } finally { elements.missionRegion.setAttribute("aria-busy", "false"); }
}

function renderMissionIdle(message) { if (message) { elements.missionView.replaceChildren(text("p", message, "status-card")); setMissionMessage(""); } else renderMissionOverview(); }

async function loadMissionFromHash() {
  const match = location.hash.match(/^#mission=(.+)$/); if (!match) return false;
  let id; try { id = decodeURIComponent(match[1]); } catch { id = ""; }
  if (!id) { renderMissionIdle("Diese Missionsakte wurde nicht gefunden. Kehre zum Board zurück."); return true; }
  missionState.status = "loading"; elements.missionRegion.setAttribute("aria-busy", "true"); renderMissionIdle("Missionsakte wird geladen …");
  try { const payload = await apiRequest(`/api/missions/${encodeURIComponent(id)}`); missionState = { ...missionState, status: "detail", mission: payload.mission }; renderMissionDetail(payload.mission); }
  catch (error) { missionState.status = error.status === 404 ? "notFound" : "error"; renderMissionIdle(error.status === 404 ? "Diese Missionsakte wurde nicht gefunden. Die Arbeitszelle bleibt erhalten." : "Die Missionsakte konnte nicht geladen werden. Bitte versuche es erneut."); }
  finally { elements.missionRegion.setAttribute("aria-busy", "false"); }
  return true;
}

async function exportMissions() {
  try { const response = await fetch("/api/missions-export"); if (!response.ok) throw new Error(); const blob = await response.blob(); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "missions-v2.json"; link.click(); URL.revokeObjectURL(link.href); setMissionMessage("Missionsakten exportiert."); }
  catch { setMissionMessage("Missionsakten konnten nicht exportiert werden.", true); }
}

function restoreError(error) {
  if (error.status === 413 || error.code === "LIMIT_EXCEEDED" || error.code === "REQUEST_TOO_LARGE") return "Die Datei ist zu groß und wurde nicht übernommen.";
  if (error.status === 415) return "Es wird eine JSON-Datei benötigt.";
  if (error.code === "UNSUPPORTED_VERSION") return "Die Sicherung verwendet eine nicht unterstützte neuere Version. Nichts wurde geändert.";
  if (["INVALID_JSON", "INVALID_DATA"].includes(error.code)) return "Die Sicherung ist ungültig. Nichts wurde geändert.";
  if (error.status === 409) return "Die Vorschau ist nicht mehr aktuell. Erstelle eine neue Vorschau.";
  return "Wiederherstellung nicht erfolgt; der vorherige Stand bleibt erhalten.";
}

async function previewRestore() {
  const file = elements.restoreFile.files[0]; if (!file) { setMissionMessage("Wähle zuerst eine JSON-Sicherung aus.", true); elements.restoreFile.focus(); return; }
  if (file.size > 128 * 1024) { setMissionMessage("Die Datei ist zu groß und wurde nicht übernommen.", true); elements.restoreFile.focus(); return; }
  try {
    const raw = await file.text(); let document; try { document = JSON.parse(raw); } catch { throw { code: "INVALID_JSON" }; }
    const payload = await apiRequest("/api/missions-restore/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(document) });
    missionState.preview = payload.preview; const preview = payload.preview; elements.restorePreview.replaceChildren(text("h3", "Vorschau bereit"), text("p", `Schema-Version ${preview.schemaVersion}; ${preview.missionCount} Akten; Digest ${preview.digest}; aktuelle Store-Version ${preview.currentStoreRevision}.`));
    const apply = createButton("Geprüfte Sicherung wiederherstellen"); apply.id = "apply-restore"; apply.addEventListener("click", applyRestore); elements.restorePreview.append(apply); apply.focus();
  } catch (error) { missionState.preview = null; elements.restorePreview.replaceChildren(); setMissionMessage(restoreError(error), true); elements.restoreFile.focus(); }
}

async function applyRestore() {
  const preview = missionState.preview; if (!preview) return;
  try { await apiRequest("/api/missions-restore/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ previewToken: preview.previewToken, expectedStoreRevision: preview.currentStoreRevision }) }); missionState.preview = null; elements.restorePreview.replaceChildren(); if (!(await loadMissionFromHash())) await renderMissionOverview(); setMissionMessage("Sicherung wiederhergestellt."); }
  catch (error) { setMissionMessage(restoreError(error), true); elements.previewRestore.focus(); }
}

function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function createButton(label, className = "button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}

function activeFilterText() {
  return [...state.activeExpertise].join(", ");
}

function renderFilters() {
  elements.filterOptions.replaceChildren();
  if (state.status !== "ready") return;

  for (const expertise of listExpertise(state.members)) {
    const label = document.createElement("label");
    label.className = "filter";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "expertise";
    input.value = expertise;
    input.checked = state.activeExpertise.has(expertise);
    input.addEventListener("change", () => {
      const next = new Set(state.activeExpertise);
      if (input.checked) next.add(expertise);
      else next.delete(expertise);
      state = { ...state, activeExpertise: next };
      render();
    });
    label.append(input, text("span", expertise));
    elements.filterOptions.append(label);
  }
}

function createCard(member) {
  const selected = state.selectedIds.has(member.id);
  const cellIsFull = state.selectedIds.size >= MAX_CELL_SIZE;
  const card = document.createElement("article");
  card.className = `member-card${selected ? " member-card--selected" : ""}`;

  const top = document.createElement("div");
  top.className = "member-card__top";
  top.append(text("span", "", "member-card__seal"));
  const headings = document.createElement("div");
  headings.append(text("h3", member.name), text("p", member.role, "role"));
  top.append(headings);

  const chips = document.createElement("div");
  chips.className = "chips";
  const shownExpertise = member.expertise.slice(0, 2);
  for (const expertise of shownExpertise) {
    chips.append(text("span", expertise, "chip"));
  }
  if (member.expertise.length > shownExpertise.length) {
    chips.append(
      text("span", `+${member.expertise.length - shownExpertise.length}`, "chip"),
    );
  }

  const action = createButton(
    selected ? "Aus Arbeitszelle entfernen" : "Zur Arbeitszelle hinzufügen",
  );
  action.dataset.memberAction = member.id;
  action.setAttribute("aria-pressed", String(selected));
  action.disabled = !selected && cellIsFull;
  if (action.disabled) action.setAttribute("aria-describedby", "cell-limit-message");
  action.addEventListener("click", () => selectMember(member.id));

  card.append(
    top,
    chips,
    text("p", member.mission),
    text("p", member.profile, "profile"),
    action,
  );
  return card;
}

function renderTeam() {
  elements.team.replaceChildren();
  elements.team.setAttribute("aria-busy", String(state.status === "loading"));
  if (state.status === "loading") {
    elements.results.textContent = "Team wird geladen …";
    elements.team.append(text("p", "Team wird geladen …", "status-card"));
    return;
  }
  if (state.status === "error") {
    elements.results.textContent = "Team nicht verfügbar";
    const card = document.createElement("section");
    card.className = "status-card status-card--error";
    card.append(
      text("h3", "Das Team konnte nicht geladen werden"),
      text("p", "Bitte versuche es erneut."),
    );
    const retry = createButton("Erneut laden");
    retry.addEventListener("click", loadTeam);
    card.append(retry);
    elements.team.append(card);
    return;
  }

  const members = filterMembers(state.members, state.query, state.activeExpertise);
  const filterSuffix = state.activeExpertise.size
    ? `; Fachgebiete: ${activeFilterText()}`
    : "";
  elements.results.textContent = `${members.length} von ${state.members.length} Teammitgliedern angezeigt${filterSuffix}`;
  if (members.length === 0) {
    const empty = document.createElement("section");
    empty.className = "status-card";
    empty.append(
      text("h3", "Keine passenden Ninja Kittens gefunden."),
      text("p", "Passe Suche oder Fachgebiete an."),
    );
    const reset = createButton(
      "Filter und Suche zurücksetzen",
      "button button--secondary",
    );
    reset.addEventListener("click", resetDiscovery);
    empty.append(reset);
    elements.team.append(empty);
    return;
  }
  const grid = document.createElement("div");
  grid.className = "team-grid";
  for (const member of members) grid.append(createCard(member));
  elements.team.append(grid);
}

function renderSelection() {
  const selectedMembers = state.members.filter((member) =>
    state.selectedIds.has(member.id),
  );
  const isFull = selectedMembers.length >= MAX_CELL_SIZE;
  elements.count.textContent = `${selectedMembers.length} von ${MAX_CELL_SIZE} gewählt`;
  elements.limitMessage.hidden = !isFull;
  elements.limitMessage.textContent = isFull
    ? "Die Arbeitszelle ist voll. Entferne ein Mitglied, um jemand anderen hinzuzufügen."
    : "";
  elements.clearCell.disabled = selectedMembers.length === 0;
  elements.copyCell.disabled = selectedMembers.length === 0;
  elements.createMission.disabled = selectedMembers.length === 0;
  elements.missionHint.textContent = selectedMembers.length === 0
    ? "Wähle 1 bis 4 Teammitglieder, um eine Missionsakte zu erstellen."
    : `Missionsakte für ${selectedMembers.length} gewählte Teammitglieder erstellen.`;
  elements.selected.replaceChildren();
  if (selectedMembers.length === 0) {
    elements.selected.append(
      text(
        "p",
        "Noch niemand gewählt. Wähle bis zu vier passende Teammitglieder aus den Karten.",
        "empty-cell",
      ),
    );
    return;
  }
  const list = document.createElement("ul");
  list.className = "selected-list";
  for (const member of selectedMembers) {
    const item = document.createElement("li");
    item.className = "selected-member";
    const details = document.createElement("div");
    details.append(text("strong", member.name), text("p", member.role));
    const remove = createButton(`${member.name} entfernen`, "remove-button");
    remove.setAttribute("aria-label", `${member.name} aus der Arbeitszelle entfernen`);
    remove.addEventListener("click", () => selectMember(member.id, true));
    item.append(details, remove);
    list.append(item);
  }
  elements.selected.append(list);
}

function setShareStatus(message) {
  elements.shareStatus.textContent = message;
}

function restoreSharedCell({ clearMissing = false } = {}) {
  const restored = restoreCell(window.location.hash, state.members);
  if (!restored.hasCell) {
    if (clearMissing) {
      state = { ...state, selectedIds: new Set() };
      setShareStatus("Geteilte Arbeitszelle aus der Navigation entfernt.");
    }
    return;
  }
  state = { ...state, selectedIds: restored.selectedIds };
  if (restored.invalid || restored.selectedIds.size === 0) {
    setShareStatus("Arbeitszelle konnte nicht wiederhergestellt werden. Die Auswahl bleibt leer.");
  } else if (restored.ignored.unknown || restored.ignored.duplicate || restored.ignored.overflow) {
    setShareStatus(`Arbeitszelle mit ${restored.selectedIds.size} Mitgliedern wiederhergestellt. Unbekannte, doppelte oder weitere Einträge wurden ausgelassen.`);
  } else {
    setShareStatus(`Arbeitszelle mit ${restored.selectedIds.size} Mitgliedern wiederhergestellt.`);
  }
}

async function copySharedCell() {
  const url = new URL(window.location.href);
  url.hash = serializeCell(state.selectedIds, state.members);
  if (window.location.hash !== url.hash) locallySharedHash = url.hash;
  window.location.hash = url.hash;
  try {
    await navigator.clipboard.writeText(url.href);
    setShareStatus("Link zur Arbeitszelle kopiert.");
  } catch {
    setShareStatus("Link konnte nicht kopiert werden. Bitte kopiere ihn aus der Adresszeile.");
  }
}

function render() {
  const discoveryActive = state.query !== "" || state.activeExpertise.size > 0;
  elements.search.value = state.query;
  elements.clearDiscovery.hidden = !discoveryActive;
  renderTeam();
  renderSelection();
}

function selectMember(memberId, fromSummary = false) {
  try {
    state = {
      ...state,
      selectedIds: toggleSelection(state.selectedIds, memberId, state.members),
    };
    render();
    const cardAction = document.querySelector(`[data-member-action="${memberId}"]`);
    if (cardAction) {
      cardAction.focus();
    } else if (fromSummary && !elements.clearCell.disabled) {
      elements.clearCell.focus();
    } else {
      elements.search.focus();
    }
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.CELL_LIMIT) {
      render();
    } else {
      throw error;
    }
  }
}

function resetDiscovery() {
  state = clearDiscovery(state);
  renderFilters();
  render();
  elements.search.focus();
}

function toLoadError(error) {
  if (error instanceof AppError) return error;
  if (error instanceof SyntaxError) {
    return new AppError(ERROR_CODES.JSON, "Team JSON is invalid.", { cause: error });
  }
  return new AppError(ERROR_CODES.NETWORK, "Team data request failed.", {
    cause: error,
  });
}

async function loadTeam() {
  state = { ...state, status: "loading", error: null, members: [] };
  renderFilters();
  render();
  try {
    let response;
    try {
      response = await fetch("data/team.json", {
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      throw new AppError(ERROR_CODES.NETWORK, "Team data request failed.", {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new AppError(
        ERROR_CODES.HTTP,
        `Team request failed with ${response.status}.`,
        { status: response.status },
      );
    }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new AppError(ERROR_CODES.JSON, "Team JSON is invalid.", { cause: error });
    }
    state = { ...state, status: "ready", members: validateTeam(payload) };
    restoreMissionFiltersFromUrl();
    if (!(await loadMissionFromHash())) { restoreSharedCell(); await renderMissionOverview(); }
  } catch (error) {
    state = { ...state, status: "error", error: toLoadError(error) };
  }
  renderFilters();
  render();
}

elements.search.addEventListener("input", (event) => {
  state = { ...state, query: event.target.value };
  render();
});
elements.clearDiscovery.addEventListener("click", resetDiscovery);
elements.clearCell.addEventListener("click", () => {
  state = clearCell(state);
  render();
});
elements.copyCell.addEventListener("click", copySharedCell);
elements.createMission.addEventListener("click", () => {
  if (state.selectedIds.size < 1) return;
  missionState = { ...missionState, status: "editing", mission: null };
  renderMissionForm(missionInput());
  elements.missionRegion.scrollIntoView({ block: "start" });
});
elements.exportMissions.addEventListener("click", exportMissions);
elements.previewRestore.addEventListener("click", previewRestore);
function routeLocationChange() {
  if (state.status !== "ready") return;
  if (window.location.href === lastRoutedHref) return;
  lastRoutedHref = window.location.href;
  if (window.location.hash.startsWith("#mission=")) {
    locallySharedHash = null;
    loadMissionFromHash();
    return;
  }
  if (window.location.hash === locallySharedHash) {
    locallySharedHash = null;
    return;
  }
  locallySharedHash = null;
  restoreMissionFiltersFromUrl();
  restoreSharedCell({ clearMissing: true });
  render();
  renderMissionOverview();
}

window.addEventListener("popstate", routeLocationChange);
window.addEventListener("hashchange", routeLocationChange);

loadTeam();
