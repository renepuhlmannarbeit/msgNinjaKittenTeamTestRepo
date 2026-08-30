import assert from "node:assert/strict";
import * as filesystem from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MissionStore } from "../src/mission-store.js";
import { MAX_DOCUMENT_BYTES, MissionError, canonicalDocument, createMission, missionListItem, transitionMission, updateMission, validateDocument } from "../src/missions.js";
import { tagComparisonIncludes } from "../src/tag-rules.js";
import { createAppServer } from "../scripts/server.mjs";

const knownIds = new Set(["backendi", "fronti", "testihesti", "devheavy"]);
const input = { title: "Missionsakte", outcome: "Ein prüfbares Ergebnis", constraints: "Nur lokal", criteria: ["API-Test ist grün"], agentIds: ["backendi"], tags: [] };
const completion = { summary: "Release erfolgreich geprüft", evidence: ["PR #42", "npm test (grün)"] };

function asV1(mission) { const { completion: ignored, tags: ignoredTags, ...legacy } = mission; return legacy; }
function asV2(mission) { const { tags: ignored, ...legacy } = mission; return legacy; }

function code(expected) { return (error) => error instanceof MissionError && error.code === expected; }

test("Tag-Suchvergleich verwendet NFC und Unicode-Case-Mapping ohne Kompatibilitätsnormalisierung", () => {
  for (const [value, query] of [["Release", "release"], ["Straße", "STRASSE"], ["Ä", "A\u0308"], ["ſ", "s"], ["ﬃ", "ffi"], ["Ａ", "ａ"]]) assert.equal(tagComparisonIncludes(value, query), true);
  for (const [value, query] of [["İ", "i"], ["①", "1"], ["Ａ", "a"], ["ﬃ", "fb03"], ["ﬃ", "u{fb"], ["ſ", "17f"], ["①", "2460"]]) assert.equal(tagComparisonIncludes(value, query), false);
});

function failOnceAt(operation, target, skip = 0) {
  let failed = false;
  const inject = (name, path) => {
    if (!failed && name === operation && path.endsWith(target)) {
      if (skip > 0) { skip -= 1; return; }
      failed = true;
      throw Object.assign(new Error(`injected ${name} failure`), { code: "EIO" });
    }
  };
  return {
    ...filesystem,
    async readFile(path, ...args) { inject("readFile", path); return filesystem.readFile(path, ...args); },
    async rename(source, destination) { inject("rename", destination); return filesystem.rename(source, destination); },
    async open(path, ...args) {
      inject("open", path);
      const handle = await filesystem.open(path, ...args);
      return new Proxy(handle, { get(value, property) {
        if (property === "writeFile" || property === "sync") return async (...methodArgs) => { inject(property, path); return value[property](...methodArgs); };
        const member = value[property]; return typeof member === "function" ? member.bind(value) : member;
      } });
    },
  };
}

test("Domänenvertrag validiert Agenten, Revisionen und vorwärtsgerichtete Statuswechsel", () => {
  const draft = createMission(input, knownIds, "2026-08-27T00:00:00.000Z", "abcdefghijklmnop");
  assert.equal(draft.status, "draft"); assert.equal(draft.revision, 1);
  assert.throws(() => createMission({ ...input, agentIds: ["unknown"] }, knownIds), code("UNKNOWN_AGENT"));
  assert.throws(() => updateMission(draft, input, 0, knownIds), code("REVISION_CONFLICT"));
  const ready = transitionMission(draft, "ready", 1); assert.equal(ready.revision, 2);
  assert.throws(() => transitionMission(ready, "draft", 2), code("INVALID_TRANSITION"));
  assert.throws(() => transitionMission(ready, "completed", 2), code("INVALID_DATA"));
  assert.throws(() => transitionMission(ready, "completed", 2, { ...completion, evidence: [] }), code("INVALID_DATA"));
  const completed = transitionMission(ready, "completed", 2, completion);
  assert.deepEqual(completed.completion, completion);
  assert.throws(() => updateMission(completed, input, 3, knownIds), code("INVALID_TRANSITION"));
});

test("Listenvertrag ergänzt zugeordnete Kitten aus dem Teamverzeichnis", () => {
  const mission = createMission(input, knownIds, "2026-08-27T00:00:00.000Z", "abcdefghijklmnop");
  const listed = missionListItem(mission, new Map([
    ["backendi", { id: "backendi", name: "Backendi", role: "Backend-Entwicklung" }],
  ]));
  assert.deepEqual(listed.agents, [{ id: "backendi", name: "Backendi", role: "Backend-Entwicklung" }]);
  assert.equal("agentIds" in listed, false);
  assert.throws(() => missionListItem(mission, new Map()), code("UNKNOWN_AGENT"));
});

test("Schema v1 und v2 migrieren verlustfrei mit leeren Tags; Schema v3 bewahrt den Tag-Vertrag", () => {
  const mission = createMission(input, knownIds, "2026-08-27T00:00:00.000Z", "abcdefghijklmnop");
  const document = { schemaVersion: 1, storeRevision: 1, missions: [asV1(mission)] };
  const migrated = validateDocument(document, knownIds);
  assert.equal(migrated.schemaVersion, 3); assert.deepEqual(migrated.missions[0], mission);
  const completed = transitionMission(transitionMission(mission, "ready", 1), "completed", 2, completion);
  assert.deepEqual(validateDocument({ schemaVersion: 2, storeRevision: 2, missions: [asV2(completed)] }, knownIds).missions[0], completed);
  assert.deepEqual(createMission({ ...input, tags: [" Release ", "\u0130", "i", "\u2460", "1"] }, knownIds).tags, ["Release", "\u0130", "i", "\u2460", "1"]);
  for (const tags of [["Release", "release"], ["Stra\u00dfe", "STRASSE"], ["\u00c4", "A\u0308"]]) assert.throws(() => createMission({ ...input, tags }, knownIds), code("INVALID_DATA"));
  for (const tags of [["\u017f", "s"], ["ﬃ", "ffi"], ["Ａ", "ａ"]]) assert.throws(() => createMission({ ...input, tags }, knownIds), code("INVALID_DATA"));
  assert.throws(() => createMission({ ...input, tags: Array(6).fill("tag") }, knownIds), code("INVALID_DATA"));
  assert.equal(createMission({ ...input, tags: ["x".repeat(24)] }, knownIds).tags[0], "x".repeat(24));
  assert.throws(() => createMission({ ...input, tags: ["x".repeat(25)] }, knownIds), code("LIMIT_EXCEEDED"));
  assert.throws(() => validateDocument({ ...document, schemaVersion: 4 }, knownIds), code("UNSUPPORTED_VERSION"));
  assert.throws(() => validateDocument({ ...document, surprise: true }, knownIds), code("INVALID_DATA"));
});

test("Store persistiert über Neustart, serialisiert Revisionen und schützt Restore-Vorschau", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "missions-store-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "missions.json"); const first = await new MissionStore(file, knownIds).initialize();
  const created = await first.create({ ...input, tags: ["Sichtbar"] }); const updated = await first.update(created.id, { ...input, title: "Neu", tags: ["Sichtbar"] }, 1);
  await assert.rejects(first.update(created.id, input, 1), (error) => error.code === "REVISION_CONFLICT");
  const restarted = await new MissionStore(file, knownIds).initialize(); assert.equal(restarted.get(created.id).title, "Neu"); assert.deepEqual(restarted.get(created.id).tags, ["Sichtbar"]);
  const before = restarted.snapshot(); const incoming = { schemaVersion: 1, storeRevision: 999, missions: [] }; const preview = restarted.preview(incoming);
  await assert.rejects(restarted.restore("invented", before.storeRevision), (error) => error.code === "PREVIEW_MISMATCH");
  assert.deepEqual(restarted.snapshot(), before);
  await restarted.restore(preview.previewToken, before.storeRevision);
  assert.equal(restarted.snapshot().missions.length, 0); assert.equal(restarted.snapshot().storeRevision, incoming.storeRevision);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), restarted.snapshot());
  await assert.rejects(restarted.restore(preview.previewToken, restarted.snapshot().storeRevision), (error) => error.code === "PREVIEW_MISMATCH");
});

test("Export, Restore in frischem Store und Neustart bewahren nichtleere Tags", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "missions-tags-export-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await new MissionStore(join(directory, "source.json"), knownIds).initialize();
  await source.create({ ...input, tags: ["Erste Schreibweise"] });
  const destinationFile = join(directory, "destination.json"); const destination = await new MissionStore(destinationFile, knownIds).initialize();
  const preview = destination.preview(source.snapshot()); await destination.restore(preview.previewToken, preview.currentStoreRevision);
  assert.deepEqual((await new MissionStore(destinationFile, knownIds).initialize()).snapshot().missions[0].tags, ["Erste Schreibweise"]);
});

test("Store stellt bei Schreibfehler und jedem offenen Recovery-Fenster bytegenau wieder her", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "missions-recovery-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "missions.json"); const store = await new MissionStore(file, knownIds).initialize(); await store.create(input);
  const before = await readFile(file);
  const failingFs = { ...filesystem, async rename(source, target) { if (target === file) throw Object.assign(new Error("injected rename failure"), { code: "EIO" }); return filesystem.rename(source, target); } };
  const failing = await new MissionStore(file, knownIds, failingFs).initialize();
  await assert.rejects(failing.create({ ...input, title: "nicht gespeichert" }), /injected rename failure/);
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual((await new MissionStore(file, knownIds).initialize()).snapshot(), store.snapshot());

  await writeFile(`${file}.recovery`, before, { mode: 0o600 });
  await writeFile(file, canonicalDocument({ schemaVersion: 1, storeRevision: 99, missions: [] }), { mode: 0o600 });
  const recovered = await new MissionStore(file, knownIds).initialize();
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(recovered.snapshot(), store.snapshot());
});

test("Fault Injection an Write-, Sync-, Rename- und Nachlesegrenzen bewahrt den Vorzustand", async (t) => {
  for (const [operation, target, skip] of [["open", ".recovery.tmp", 0], ["writeFile", ".json.tmp", 0], ["sync", ".json.tmp", 0], ["rename", "missions.json", 0], ["readFile", "missions.json", 2]]) {
    const directory = await mkdtemp(join(tmpdir(), `missions-${operation}-`)); t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, "missions.json"); const baseline = await new MissionStore(file, knownIds).initialize(); await baseline.create(input);
    const before = await readFile(file);
    const store = await new MissionStore(file, knownIds, failOnceAt(operation, target, skip)).initialize();
    await assert.rejects(store.create({ ...input, title: operation }), new RegExp(`injected ${operation} failure`), `${operation} must reach the injected boundary`);
    assert.deepEqual(await readFile(file), before, `${operation} must preserve exact bytes`);
    assert.deepEqual((await new MissionStore(file, knownIds).initialize()).snapshot(), baseline.snapshot(), `${operation} must preserve restart state`);
  }
});

test("Dokumentgrenze wird zentral für validierte Store-Kandidaten erzwungen", () => {
  const mission = createMission({ ...input, outcome: "x".repeat(2000), constraints: "y".repeat(4000), criteria: Array(5).fill("z".repeat(500)) }, knownIds, "2026-08-27T00:00:00.000Z", "abcdefghijklmnop");
  const missions = Array.from({ length: 100 }, (_, index) => ({ ...mission, id: `mission-${String(index).padStart(8, "0")}` }));
  const oversized = { schemaVersion: 3, storeRevision: 1, missions };
  assert.ok(Buffer.byteLength(canonicalDocument(oversized)) > MAX_DOCUMENT_BYTES);
  assert.throws(() => validateDocument(oversized, knownIds), code("LIMIT_EXCEEDED"));
});

test("lokale API liefert stabile Fehlercodes für Create, Get und Konflikt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "missions-api-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const server = await createAppServer({ missionsFile: join(directory, "missions.json") }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const taggedInput = { ...input, tags: [" Erste ", "\u0130", "i"] };
  const createdResponse = await fetch(`${base}/api/missions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(taggedInput) });
  assert.equal(createdResponse.status, 201); const { mission } = await createdResponse.json();
  assert.deepEqual(mission.tags, ["Erste", "\u0130", "i"]);
  const editedResponse = await fetch(`${base}/api/missions/${mission.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mission: { ...taggedInput, tags: ["Bearbeitet"] }, expectedRevision: mission.revision }) });
  assert.equal(editedResponse.status, 200); assert.deepEqual((await editedResponse.json()).mission.tags, ["Bearbeitet"]);
  const second = await (await fetch(`${base}/api/missions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, title: "Zweite Mission" }) })).json();
  const listed = await (await fetch(`${base}/api/missions`)).json();
  assert.deepEqual(listed.missions.map(({ id }) => id).sort(), [second.mission.id, mission.id].sort());
  assert.ok(listed.missions[0].updatedAt >= listed.missions[1].updatedAt);
  assert.deepEqual(Object.keys(listed.missions[0]).sort(), ["agents", "id", "outcome", "status", "tags", "title", "updatedAt"]);
  assert.deepEqual(listed.missions[0].agents, [{ id: "backendi", name: "Backendi", role: "Backend-Entwicklung" }]);
  const loaded = await fetch(`${base}/api/missions/${mission.id}`); assert.equal(loaded.status, 200);
  const beforeRejectedRestore = await (await fetch(`${base}/api/missions-export`)).text();
  for (const [body, expectedStatus, expectedCode] of [
    ["{", 400, "INVALID_JSON"],
    [JSON.stringify({ schemaVersion: 4, storeRevision: 0, missions: [] }), 422, "UNSUPPORTED_VERSION"],
    [JSON.stringify({ schemaVersion: 1, storeRevision: 0, missions: [{ ...asV1(mission), agentIds: ["unknown"] }] }), 422, "UNKNOWN_AGENT"],
    ["x".repeat(128 * 1024 + 1), 413, "REQUEST_TOO_LARGE"],
  ]) {
    const rejected = await fetch(`${base}/api/missions-restore/preview`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(rejected.status, expectedStatus);
    assert.equal((await rejected.json()).error.code, expectedCode);
    assert.equal(await (await fetch(`${base}/api/missions-export`)).text(), beforeRejectedRestore, `${expectedCode} must preserve the existing document`);
  }
  const conflict = await fetch(`${base}/api/missions/${mission.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "ready", expectedRevision: 0 }) });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.code, "REVISION_CONFLICT");
  const readyResponse = await fetch(`${base}/api/missions/${mission.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "ready", expectedRevision: 2 }) });
  assert.equal(readyResponse.status, 200);
  const missingCompletion = await fetch(`${base}/api/missions/${mission.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "completed", expectedRevision: 3 }) });
  assert.equal(missingCompletion.status, 422); assert.equal((await missingCompletion.json()).error.code, "INVALID_DATA");
  const completedResponse = await fetch(`${base}/api/missions/${mission.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "completed", expectedRevision: 3, completion }) });
  assert.equal(completedResponse.status, 200); assert.deepEqual((await completedResponse.json()).mission.completion, completion);
  assert.equal((await fetch(`${base}/api/missions/not-valid`)).status, 404);
  const exported = await fetch(`${base}/api/missions-export`); const exportBytes = await exported.text();
  assert.equal(exportBytes, canonicalDocument(JSON.parse(exportBytes)));
  const exportedDocument = JSON.parse(exportBytes);
  const previewResponse = await fetch(`${base}/api/missions-restore/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(exportedDocument) });
  const { preview } = await previewResponse.json();
  const withoutPreview = await fetch(`${base}/api/missions-restore/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ previewToken: "invented", expectedStoreRevision: preview.currentStoreRevision }) });
  assert.equal(withoutPreview.status, 409);
  const applied = await fetch(`${base}/api/missions-restore/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ previewToken: preview.previewToken, expectedStoreRevision: preview.currentStoreRevision }) });
  assert.equal(applied.status, 200);
  assert.deepEqual((await applied.json()).document, exportedDocument);
  const reused = await fetch(`${base}/api/missions-restore/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ previewToken: preview.previewToken, expectedStoreRevision: preview.currentStoreRevision + 1 }) });
  assert.equal(reused.status, 409);
});
