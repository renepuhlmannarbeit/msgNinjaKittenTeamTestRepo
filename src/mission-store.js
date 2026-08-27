import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalDocument, createMission, documentDigest, MISSION_SCHEMA_VERSION, transitionMission, updateMission, validateDocument } from "./missions.js";

export class MissionStore {
  #file;
  #knownIds;
  #document;
  #queue = Promise.resolve();

  constructor(file, knownIds) {
    this.#file = file;
    this.#knownIds = knownIds;
  }

  async initialize() {
    await mkdir(dirname(this.#file), { recursive: true });
    try {
      this.#document = validateDocument(JSON.parse(await readFile(this.#file, "utf8")), this.#knownIds);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.#document = Object.freeze({ schemaVersion: MISSION_SCHEMA_VERSION, storeRevision: 0, missions: Object.freeze([]) });
      await this.#replace(this.#document);
    }
    return this;
  }

  snapshot() { return structuredClone(this.#document); }

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
    return { schemaVersion: document.schemaVersion, missionCount: document.missions.length, incomingStoreRevision: document.storeRevision, currentStoreRevision: this.#document.storeRevision, digest: documentDigest(document) };
  }

  restore(raw, expectedStoreRevision, digest) {
    return this.#serialize(async () => {
      if (expectedStoreRevision !== this.#document.storeRevision) throw Object.assign(new Error("Store revision does not match."), { code: "REVISION_CONFLICT", details: { currentRevision: this.#document.storeRevision } });
      const incoming = validateDocument(raw, this.#knownIds);
      if (documentDigest(incoming) !== digest) throw Object.assign(new Error("Restore data differs from preview."), { code: "PREVIEW_MISMATCH" });
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
      return structuredClone(result);
    });
  }

  #serialize(operation) {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.catch(() => {});
    return result;
  }

  async #replace(next) {
    const suffix = randomBytes(8).toString("hex");
    const temporary = `${this.#file}.${suffix}.tmp`;
    const backup = `${this.#file}.${suffix}.bak`;
    const handle = await open(temporary, "wx", 0o600);
    let oldMoved = false;
    try {
      await handle.writeFile(canonicalDocument(next), "utf8");
      await handle.sync();
      await handle.close();
      try { await rename(this.#file, backup); oldMoved = true; } catch (error) { if (error?.code !== "ENOENT") throw error; }
      await rename(temporary, this.#file);
      validateDocument(JSON.parse(await readFile(this.#file, "utf8")), this.#knownIds);
      const directory = await open(dirname(this.#file), "r");
      await directory.sync();
      await directory.close();
      await rm(backup, { force: true });
    } catch (error) {
      await handle.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
      if (oldMoved) {
        await rm(this.#file, { force: true }).catch(() => {});
        await rename(backup, this.#file).catch(() => {});
      } else {
        await rm(this.#file, { force: true }).catch(() => {});
      }
      throw error;
    }
  }
}
