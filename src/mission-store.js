import { randomBytes } from "node:crypto";
import * as filesystem from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalDocument, createMission, documentDigest, MISSION_SCHEMA_VERSION, transitionMission, updateMission, validateDocument } from "./missions.js";

const PREVIEW_TTL_MS = 5 * 60 * 1000;

export class MissionStore {
  #file;
  #knownIds;
  #document;
  #fs;
  #previews = new Map();
  #queue = Promise.resolve();

  constructor(file, knownIds, fs = filesystem) {
    this.#file = file;
    this.#knownIds = knownIds;
    this.#fs = fs;
  }

  async initialize() {
    await this.#fs.mkdir(dirname(this.#file), { recursive: true });
    await this.#recover();
    try {
      this.#document = validateDocument(JSON.parse(await this.#fs.readFile(this.#file, "utf8")), this.#knownIds);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.#document = Object.freeze({ schemaVersion: MISSION_SCHEMA_VERSION, storeRevision: 0, missions: Object.freeze([]) });
      await this.#writeAtomic(this.#document);
    }
    return this;
  }

  snapshot() { return structuredClone(this.#document); }

  list() {
    return this.#document.missions
      .map(({ id, title, outcome, status, updatedAt }) => ({ id, title, outcome, status, updatedAt }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  }

  get(id) { return this.#document.missions.find((mission) => mission.id === id) ?? null; }

  create(input) {
    return this.#mutate((document) => {
      const result = createMission(input, this.#knownIds);
      return { result, missions: [...document.missions, result] };
    });
  }

  update(id, input, expectedRevision) {
    return this.#mutate((document) => {
      const current = document.missions.find((mission) => mission.id === id);
      if (!current) throw Object.assign(new Error("Mission not found."), { code: "NOT_FOUND" });
      const result = updateMission(current, input, expectedRevision, this.#knownIds);
      return { result, missions: document.missions.map((mission) => mission.id === id ? result : mission) };
    });
  }

  transition(id, status, expectedRevision) {
    return this.#mutate((document) => {
      const current = document.missions.find((mission) => mission.id === id);
      if (!current) throw Object.assign(new Error("Mission not found."), { code: "NOT_FOUND" });
      const result = transitionMission(current, status, expectedRevision);
      return { result, missions: document.missions.map((mission) => mission.id === id ? result : mission) };
    });
  }

  preview(raw) {
    const document = validateDocument(raw, this.#knownIds);
    const now = Date.now();
    for (const [token, preview] of this.#previews) if (preview.expiresAt <= now) this.#previews.delete(token);
    const previewToken = randomBytes(24).toString("base64url");
    const digest = documentDigest(document);
    this.#previews.set(previewToken, { document, digest, storeRevision: this.#document.storeRevision, expiresAt: now + PREVIEW_TTL_MS });
    return { previewToken, schemaVersion: document.schemaVersion, missionCount: document.missions.length, incomingStoreRevision: document.storeRevision, currentStoreRevision: this.#document.storeRevision, digest };
  }

  restore(previewToken, expectedStoreRevision) {
    return this.#serialize(async () => {
      if (expectedStoreRevision !== this.#document.storeRevision) throw Object.assign(new Error("Store revision does not match."), { code: "REVISION_CONFLICT", details: { currentRevision: this.#document.storeRevision } });
      const preview = this.#previews.get(previewToken);
      if (!preview || preview.expiresAt <= Date.now() || preview.storeRevision !== this.#document.storeRevision) throw Object.assign(new Error("Restore preview is missing or stale."), { code: "PREVIEW_MISMATCH" });
      this.#previews.delete(previewToken);
      const incoming = preview.document;
      const next = Object.freeze({ ...incoming, storeRevision: this.#document.storeRevision + 1 });
      await this.#replace(next);
      this.#document = next;
      return this.snapshot();
    });
  }

  #mutate(operation) {
    return this.#serialize(async () => {
      const { result, missions } = operation(this.#document);
      const next = validateDocument({ schemaVersion: MISSION_SCHEMA_VERSION, storeRevision: this.#document.storeRevision + 1, missions }, this.#knownIds);
      await this.#replace(next);
      this.#document = next;
      this.#previews.clear();
      return structuredClone(result);
    });
  }

  #serialize(operation) {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.catch(() => {});
    return result;
  }

  async #replace(next) {
    const recovery = `${this.#file}.recovery`;
    const recoveryTemporary = `${recovery}.tmp`;
    const previous = await this.#fs.readFile(this.#file);
    await this.#writeBytesAtomic(recovery, recoveryTemporary, previous);
    try {
      await this.#writeAtomic(next);
      validateDocument(JSON.parse(await this.#fs.readFile(this.#file, "utf8")), this.#knownIds);
      await this.#fs.rm(recovery, { force: true });
      await this.#syncDirectory();
    } catch (error) {
      await this.#writeBytesAtomic(this.#file, `${this.#file}.tmp`, previous).catch(() => {});
      throw error;
    }
  }

  async #recover() {
    const recovery = `${this.#file}.recovery`;
    try {
      const previous = await this.#fs.readFile(recovery);
      validateDocument(JSON.parse(previous.toString("utf8")), this.#knownIds);
      await this.#writeBytesAtomic(this.#file, `${this.#file}.tmp`, previous);
      await this.#fs.rm(recovery);
      await this.#syncDirectory();
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  async #writeAtomic(document) {
    await this.#writeBytesAtomic(this.#file, `${this.#file}.tmp`, Buffer.from(canonicalDocument(document)));
  }

  async #writeBytesAtomic(target, temporary, bytes) {
    await this.#fs.rm(temporary, { force: true });
    const handle = await this.#fs.open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await this.#fs.rename(temporary, target);
    await this.#syncDirectory();
  }

  async #syncDirectory() {
    const directory = await this.#fs.open(dirname(this.#file), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
