import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AppError,
  ERROR_CODES,
  MAX_CELL_SIZE,
  clearCell,
  clearDiscovery,
  filterMembers,
  listExpertise,
  normalizeQuery,
  toggleSelection,
  validateTeam,
} from "../src/domain.js";

const rawTeam = JSON.parse(
  await readFile(new URL("../data/team.json", import.meta.url), "utf8"),
);
const team = validateTeam(rawTeam);

function copyTeam() {
  return structuredClone(rawTeam);
}

function expectCode(callback, code) {
  assert.throws(
    callback,
    (error) => error instanceof AppError && error.code === code,
  );
}

test("der echte Teamvertrag enthält genau zwölf eindeutige, verwendbare Mitglieder", () => {
  assert.equal(team.length, 12);
  assert.equal(new Set(team.map((member) => member.id)).size, 12);
  assert.equal(new Set(team.map((member) => member.name)).size, 12);
  assert.ok(
    team.every(
      (member) => Object.isFrozen(member) && Object.isFrozen(member.expertise),
    ),
  );
  assert.deepEqual(listExpertise(team), [
    "Architektur",
    "Backend",
    "Betrieb",
    "Daten",
    "Design",
    "Frontend",
    "Integration",
    "Koordination",
    "Produkt",
    "Qualität",
    "Sicherheit",
    "Test",
  ]);
});

test("der Vertrag weist leere, fehlende und duplizierte Daten zurück", () => {
  const emptyMission = copyTeam();
  emptyMission[0].mission = " ";
  expectCode(() => validateTeam(emptyMission), ERROR_CODES.CONTRACT);

  const missingProfile = copyTeam();
  delete missingProfile[1].profile;
  expectCode(() => validateTeam(missingProfile), ERROR_CODES.CONTRACT);

  const duplicateId = copyTeam();
  duplicateId[1].id = duplicateId[0].id;
  expectCode(() => validateTeam(duplicateId), ERROR_CODES.CONTRACT);
});

test("Suche normalisiert Leerraum, Groß-/Kleinschreibung und Diakritika und durchsucht Mission sowie Profil", () => {
  assert.equal(normalizeQuery("  ÜBEr  NINJA  "), "uber ninja");
  assert.deepEqual(
    filterMembers(team, "fehlerpfade").map(({ id }) => id),
    ["backendi"],
  );
  assert.deepEqual(
    filterMembers(team, "dachfirst").map(({ id }) => id),
    ["orchestoni"],
  );
});

test("Suche und Fachgebiete verknüpfen UND, mehrere Fachgebiete ODER, null Treffer bleiben leer", () => {
  const expertise = new Set(["Backend", "Test"]);
  assert.deepEqual(
    filterMembers(team, "fehlerpfade", expertise).map(({ id }) => id),
    ["backendi"],
  );
  assert.deepEqual(filterMembers(team, "fehlerpfade", new Set(["Design"])), []);
  assert.deepEqual(filterMembers(team, "unmoeglicher begriff"), []);
});

test("Discovery-Reset erhält die Arbeitszelle, Zell-Reset erhält Discovery", () => {
  const state = {
    query: "backend",
    activeExpertise: new Set(["Backend"]),
    selectedIds: new Set(["backendi", "testihesti"]),
  };
  const discoveryReset = clearDiscovery(state);
  assert.equal(discoveryReset.query, "");
  assert.deepEqual([...discoveryReset.activeExpertise], []);
  assert.deepEqual([...discoveryReset.selectedIds], ["backendi", "testihesti"]);

  const cellReset = clearCell(state);
  assert.equal(cellReset.query, "backend");
  assert.deepEqual([...cellReset.activeExpertise], ["Backend"]);
  assert.deepEqual([...cellReset.selectedIds], []);
});

test("Auswahl schützt gegen unbekannte IDs und Limitüberschreitung, erlaubt Entfernen auch bei voller oder weggefilterter Auswahl", () => {
  expectCode(
    () => toggleSelection(new Set(), "nicht-vorhanden", team),
    ERROR_CODES.UNKNOWN_MEMBER,
  );

  let selected = new Set();
  for (const member of team.slice(0, MAX_CELL_SIZE)) {
    selected = toggleSelection(selected, member.id, team);
  }
  assert.equal(selected.size, MAX_CELL_SIZE);
  expectCode(
    () => toggleSelection(selected, team[4].id, team),
    ERROR_CODES.CELL_LIMIT,
  );

  const afterRemoval = toggleSelection(selected, team[0].id, team);
  assert.equal(afterRemoval.size, MAX_CELL_SIZE - 1);
  assert.equal(afterRemoval.has(team[0].id), false);

  const filteredOut = filterMembers(team, "dachfirst");
  assert.equal(filteredOut.some(({ id }) => id === team[1].id), false);
  const removedFilteredMember = toggleSelection(selected, team[1].id, team);
  assert.equal(removedFilteredMember.has(team[1].id), false);
});
