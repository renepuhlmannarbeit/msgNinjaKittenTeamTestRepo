import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MissionStore } from "../src/mission-store.js";
import { MissionError, createMission, documentDigest, transitionMission, updateMission, validateDocument } from "../src/missions.js";
import { createAppServer } from "../scripts/server.mjs";

const knownIds = new Set(["backendi", "fronti", "testihesti", "devheavy"]);
const input = { title: "Missionsakte", outcome: "Ein prüfbares Ergebnis", constraints: "Nur lokal", criteria: ["API-Test ist grün"], agentIds: ["backendi"] };

function code(expected) { return (error) => error instanceof MissionError && error.code === expected; }

test("Domänenvertrag validiert Agenten, Revisionen und vorwärtsgerichtete Statuswechsel", () => {
  const draft = createMission(input, knownIds, "2026-08-27T00:00:00.000Z", "abcdefghijklmnop");
  assert.equal(draft.status, "draft"); assert.equal(draft.revision, 1);
  assert.throws(() => createMission({ ...input, agentIds: ["unknown"] }, knownIds), code("UNKNOWN_AGENT"));
  assert.throws(() => updateMission(draft, input, 0, knownIds), code("REVISION_CONFLICT"));
  const ready = transitionMission(draft, "ready", 1); assert.equal(ready.revision, 2);
  assert.throws(() => transitionMission(ready, "draft", 2), code("INVALID_TRANSITION"));
  const completed = transitionMission(ready, "completed", 2);
  assert.throws(() => updateMission(completed, input, 3, knownIds), code("INVALID_TRANSITION"));
});

test("Schema v1 weist unbekannte Felder, neuere Versionen und beschädigte Daten vollständig ab", () => {
  const mission = createMission(input, knownIds, "2026-08-27T00:00:00.000Z", "abcdefghijklmnop");
  const document = { schemaVersion: 1, storeRevision: 1, missions: [mission] };
  assert.deepEqual(validateDocument(document, knownIds).missions[0], mission);
  assert.throws(() => validateDocument({ ...document, schemaVersion: 2 }, knownIds), code("UNSUPPORTED_VERSION"));
  assert.throws(() => validateDocument({ ...document, surprise: true }, knownIds), code("INVALID_DATA"));
});

test("Store persistiert über Neustart, serialisiert Revisionen und schützt Restore-Vorschau", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "missions-store-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "missions.json"); const first = await new MissionStore(file, knownIds).initialize();
  const created = await first.create(input); const updated = await first.update(created.id, { ...input, title: "Neu" }, 1);
  await assert.rejects(first.update(created.id, input, 1), (error) => error.code === "REVISION_CONFLICT");
  const restarted = await new MissionStore(file, knownIds).initialize(); assert.equal(restarted.get(created.id).title, "Neu");
  const before = restarted.snapshot(); const incoming = { schemaVersion: 1, storeRevision: 999, missions: [] }; const preview = restarted.preview(incoming);
  await assert.rejects(restarted.restore(incoming, before.storeRevision, "0".repeat(64)), (error) => error.code === "PREVIEW_MISMATCH");
  assert.deepEqual(restarted.snapshot(), before);
  await restarted.restore(incoming, before.storeRevision, documentDigest(validateDocument(incoming, knownIds)));
  assert.equal(restarted.snapshot().missions.length, 0); assert.equal(restarted.snapshot().storeRevision, before.storeRevision + 1);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), restarted.snapshot());
});

test("lokale API liefert stabile Fehlercodes für Create, Get und Konflikt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "missions-api-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const server = await createAppServer({ missionsFile: join(directory, "missions.json") }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const createdResponse = await fetch(`${base}/api/missions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(createdResponse.status, 201); const { mission } = await createdResponse.json();
  const loaded = await fetch(`${base}/api/missions/${mission.id}`); assert.equal(loaded.status, 200);
  const conflict = await fetch(`${base}/api/missions/${mission.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "ready", expectedRevision: 0 }) });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.code, "REVISION_CONFLICT");
  assert.equal((await fetch(`${base}/api/missions/not-valid`)).status, 404);
});
