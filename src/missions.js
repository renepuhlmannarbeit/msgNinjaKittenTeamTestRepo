import { createHash, randomBytes } from "node:crypto";

export const MISSION_SCHEMA_VERSION = 2;
export const MAX_MISSIONS = 100;
export const MAX_DOCUMENT_BYTES = 128 * 1024;
export const MAX_TITLE_LENGTH = 120;
export const MAX_OUTCOME_LENGTH = 2000;
export const MAX_CONSTRAINTS_LENGTH = 4000;
export const MAX_CRITERION_LENGTH = 500;
export const MAX_COMPLETION_SUMMARY_LENGTH = 2000;
export const MAX_EVIDENCE_LENGTH = 500;
export const MISSION_STATUSES = Object.freeze(["draft", "ready", "completed"]);

export class MissionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "MissionError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new MissionError(code, message, details);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_DATA", `${label} must be an object.`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) {
    fail("INVALID_DATA", `${label} has unsupported or missing fields.`);
  }
}

function text(value, label, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string") fail("INVALID_DATA", `${label} must be text.`);
  const normalized = value.trim();
  if (!allowEmpty && normalized.length === 0) fail("INVALID_DATA", `${label} must not be empty.`);
  if (normalized.length > maximum) fail("LIMIT_EXCEEDED", `${label} exceeds ${maximum} characters.`);
  return normalized;
}

function positiveInteger(value, label, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    fail("INVALID_DATA", `${label} must be a ${allowZero ? "non-negative" : "positive"} integer.`);
  }
  return value;
}

function isoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    fail("INVALID_DATA", `${label} must be an ISO timestamp.`);
  }
  return value;
}

export function validateMissionInput(raw, knownIds) {
  const input = plainObject(raw, "Mission input");
  exactKeys(input, ["title", "outcome", "constraints", "criteria", "agentIds"], "Mission input");
  if (!(knownIds instanceof Set)) fail("INVALID_ARGUMENT", "knownIds must be a Set.");
  if (!Array.isArray(input.agentIds) || input.agentIds.length < 1 || input.agentIds.length > 4) {
    fail("INVALID_DATA", "agentIds must contain 1 to 4 entries.");
  }
  const agentIds = input.agentIds.map((id) => text(id, "Agent id", 64));
  if (new Set(agentIds).size !== agentIds.length) fail("INVALID_DATA", "agentIds must be unique.");
  const unknown = agentIds.filter((id) => !knownIds.has(id));
  if (unknown.length) fail("UNKNOWN_AGENT", "Mission contains unknown agent ids.", { agentIds: unknown });
  if (!Array.isArray(input.criteria) || input.criteria.length < 1 || input.criteria.length > 5) {
    fail("INVALID_DATA", "criteria must contain 1 to 5 entries.");
  }
  return Object.freeze({
    title: text(input.title, "Title", MAX_TITLE_LENGTH),
    outcome: text(input.outcome, "Outcome", MAX_OUTCOME_LENGTH),
    constraints: text(input.constraints, "Constraints", MAX_CONSTRAINTS_LENGTH),
    criteria: Object.freeze(input.criteria.map((item) => text(item, "Criterion", MAX_CRITERION_LENGTH))),
    agentIds: Object.freeze(agentIds),
  });
}

export function createMission(raw, knownIds, now = new Date().toISOString(), id = randomBytes(16).toString("base64url")) {
  const input = validateMissionInput(raw, knownIds);
  return Object.freeze({
    id,
    ...input,
    completion: null,
    status: "draft",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
}

export function updateMission(current, raw, expectedRevision, knownIds, now = new Date().toISOString()) {
  if (current.status === "completed") fail("INVALID_TRANSITION", "Completed missions cannot be edited.");
  if (expectedRevision !== current.revision) {
    fail("REVISION_CONFLICT", "Mission revision does not match.", { currentRevision: current.revision });
  }
  const input = validateMissionInput(raw, knownIds);
  return Object.freeze({ ...current, ...input, revision: current.revision + 1, updatedAt: now });
}

export function validateCompletion(raw) {
  const completion = plainObject(raw, "Completion");
  exactKeys(completion, ["summary", "evidence"], "Completion");
  if (!Array.isArray(completion.evidence) || completion.evidence.length < 1 || completion.evidence.length > 5) {
    fail("INVALID_DATA", "Completion evidence must contain 1 to 5 entries.");
  }
  return Object.freeze({
    summary: text(completion.summary, "Completion summary", MAX_COMPLETION_SUMMARY_LENGTH),
    evidence: Object.freeze(completion.evidence.map((item) => text(item, "Completion evidence", MAX_EVIDENCE_LENGTH))),
  });
}

export function transitionMission(current, nextStatus, expectedRevision, completion = null, now = new Date().toISOString()) {
  if (expectedRevision !== current.revision) {
    fail("REVISION_CONFLICT", "Mission revision does not match.", { currentRevision: current.revision });
  }
  if (nextStatus === current.status) return current;
  const allowed = current.status === "draft" ? "ready" : current.status === "ready" ? "completed" : null;
  if (nextStatus !== allowed) fail("INVALID_TRANSITION", `Cannot transition from ${current.status} to ${nextStatus}.`);
  if (nextStatus !== "completed" && completion !== null) fail("INVALID_DATA", "Completion is only accepted when completing a mission.");
  return Object.freeze({ ...current, status: nextStatus, completion: nextStatus === "completed" ? validateCompletion(completion) : current.completion, revision: current.revision + 1, updatedAt: now });
}

export function validateDocument(raw, knownIds) {
  const document = plainObject(raw, "Mission document");
  if (![1, MISSION_SCHEMA_VERSION].includes(document.schemaVersion)) {
    fail(document.schemaVersion > MISSION_SCHEMA_VERSION ? "UNSUPPORTED_VERSION" : "INVALID_DATA", "Unsupported mission schema version.");
  }
  exactKeys(document, ["schemaVersion", "storeRevision", "missions"], "Mission document");
  positiveInteger(document.storeRevision, "storeRevision", { allowZero: true });
  if (!Array.isArray(document.missions) || document.missions.length > MAX_MISSIONS) {
    fail("LIMIT_EXCEEDED", `missions must contain at most ${MAX_MISSIONS} entries.`);
  }
  const ids = new Set();
  const missions = document.missions.map((rawMission, index) => {
    const mission = plainObject(rawMission, `Mission ${index}`);
    exactKeys(mission, document.schemaVersion === 1 ? ["id", "title", "outcome", "constraints", "criteria", "agentIds", "status", "revision", "createdAt", "updatedAt"] : ["id", "title", "outcome", "constraints", "criteria", "agentIds", "completion", "status", "revision", "createdAt", "updatedAt"], `Mission ${index}`);
    const id = text(mission.id, "Mission id", 64);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id) || ids.has(id)) fail("INVALID_DATA", "Mission ids must be opaque and unique.");
    ids.add(id);
    const fields = validateMissionInput({
      title: mission.title,
      outcome: mission.outcome,
      constraints: mission.constraints,
      criteria: mission.criteria,
      agentIds: mission.agentIds,
    }, knownIds);
    if (!MISSION_STATUSES.includes(mission.status)) fail("INVALID_DATA", "Mission status is invalid.");
    const completion = document.schemaVersion === 1 || mission.completion === null ? null : validateCompletion(mission.completion);
    if (completion && mission.status !== "completed") fail("INVALID_DATA", "Only completed missions may contain completion details.");
    return Object.freeze({ id, ...fields, completion, status: mission.status, revision: positiveInteger(mission.revision, "Mission revision"), createdAt: isoDate(mission.createdAt, "createdAt"), updatedAt: isoDate(mission.updatedAt, "updatedAt") });
  });
  missions.sort((left, right) => left.id.localeCompare(right.id));
  const validated = Object.freeze({ schemaVersion: MISSION_SCHEMA_VERSION, storeRevision: document.storeRevision, missions: Object.freeze(missions) });
  if (Buffer.byteLength(canonicalDocument(validated), "utf8") > MAX_DOCUMENT_BYTES) {
    fail("LIMIT_EXCEEDED", `Mission document exceeds ${MAX_DOCUMENT_BYTES} bytes.`);
  }
  return validated;
}

export function canonicalDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function documentDigest(document) {
  return createHash("sha256").update(canonicalDocument(document)).digest("hex");
}
