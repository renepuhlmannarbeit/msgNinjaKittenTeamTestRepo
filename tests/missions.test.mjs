import assert from "node:assert/strict";
import * as filesystem from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MissionStore } from "../src/mission-store.js";
import { MAX_DOCUMENT_BYTES, MissionError, canonicalDocument, createMission, transitionMission, updateMission, validateDocument } from "../src/missions.js";
import { createAppServer } from "../scripts/server.mjs";

const knownIds = new Set(["backendi", "fronti", "testihesti", "devheavy"]);
const input = { title: "Missionsakte", outcome: "Ein prüfbares Ergebnis", constraints: "Nur lokal", criteria: ["API-Test ist grün"], agentIds: ["backendi"] };

function code(expected) { return (error) => error instanceof MissionError && error.code === expected; }

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
  await assert.rejects(restarted.restore("invented", before.storeRevision), (error) => error.code === "PREVIEW_MISMATCH");
  assert.deepEqual(restarted.snapshot(), before);
  await restarted.restore(preview.previewToken, before.storeRevision);
  assert.equal(restarted.snapshot().missions.length, 0); assert.equal(restarted.snapshot().storeRevision, before.storeRevision + 1);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), restarted.snapshot());
  await assert.rejects(restarted.restore(preview.previewToken, restarted.snapshot().storeRevision), (error) => error.code === "PREVIEW_MISMATCH");
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
  const oversized = { schemaVersion: 1, storeRevision: 1, missions };
  assert.ok(Buffer.byteLength(canonicalDocument(oversized)) > MAX_DOCUMENT_BYTES);
  assert.throws(() => validateDocument(oversized, knownIds), code("LIMIT_EXCEEDED"));
});

test("lokale API liefert stabile Fehlercodes für Create, Get und Konflikt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "missions-api-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const server = await createAppServer({ missionsFile: join(directory, "missions.json") }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const createdResponse = await fetch(`${base}/api/missions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(createdResponse.status, 201); const { mission } = await createdResponse.json();
  const second = await (await fetch(`${base}/api/missions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, title: "Zweite Mission" }) })).json();
  const listed = await (await fetch(`${base}/api/missions`)).json();
  assert.deepEqual(listed.missions.map(({ id }) => id).sort(), [second.mission.id, mission.id].sort());
  assert.ok(listed.missions[0].updatedAt >= listed.missions[1].updatedAt);
  assert.deepEqual(Object.keys(listed.missions[0]).sort(), ["id", "outcome", "status", "title", "updatedAt"]);
  const loaded = await fetch(`${base}/api/missions/${mission.id}`); assert.equal(loaded.status, 200);
  const beforeRejectedRestore = await (await fetch(`${base}/api/missions-export`)).text();
  for (const [body, expectedStatus, expectedCode] of [
    ["{", 400, "INVALID_JSON"],
    [JSON.stringify({ schemaVersion: 2, storeRevision: 0, missions: [] }), 422, "UNSUPPORTED_VERSION"],
    [JSON.stringify({ schemaVersion: 1, storeRevision: 0, missions: [{ ...mission, agentIds: ["unknown"] }] }), 422, "UNKNOWN_AGENT"],
    ["x".repeat(128 * 1024 + 1), 413, "REQUEST_TOO_LARGE"],
  ]) {
    const rejected = await fetch(`${base}/api/missions-restore/preview`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(rejected.status, expectedStatus);
    assert.equal((await rejected.json()).error.code, expectedCode);
    assert.equal(await (await fetch(`${base}/api/missions-export`)).text(), beforeRejectedRestore, `${expectedCode} must preserve the existing document`);
  }
  const conflict = await fetch(`${base}/api/missions/${mission.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "ready", expectedRevision: 0 }) });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.code, "REVISION_CONFLICT");
  assert.equal((await fetch(`${base}/api/missions/not-valid`)).status, 404);
  const exported = await fetch(`${base}/api/missions-export`); const exportBytes = await exported.text();
  assert.equal(exportBytes, canonicalDocument(JSON.parse(exportBytes)));
  const incoming = { schemaVersion: 1, storeRevision: 0, missions: [] };
  const previewResponse = await fetch(`${base}/api/missions-restore/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(incoming) });
  const { preview } = await previewResponse.json();
  const withoutPreview = await fetch(`${base}/api/missions-restore/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ previewToken: "invented", expectedStoreRevision: preview.currentStoreRevision }) });
  assert.equal(withoutPreview.status, 409);
  const applied = await fetch(`${base}/api/missions-restore/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ previewToken: preview.previewToken, expectedStoreRevision: preview.currentStoreRevision }) });
  assert.equal(applied.status, 200);
  const reused = await fetch(`${base}/api/missions-restore/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ previewToken: preview.previewToken, expectedStoreRevision: preview.currentStoreRevision + 1 }) });
  assert.equal(reused.status, 409);
});
