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
};

let state = {
  status: "loading",
  members: [],
  query: "",
  activeExpertise: new Set(),
  selectedIds: new Set(),
  error: null,
};

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

function restoreSharedCell() {
  const restored = restoreCell(window.location.hash, state.members);
  if (!restored.hasCell) return;
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
    restoreSharedCell();
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

loadTeam();
