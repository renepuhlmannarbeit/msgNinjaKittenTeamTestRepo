export const MAX_CELL_SIZE = 4;
export const EXPECTED_TEAM_SIZE = 12;
export const MAX_FRAGMENT_LENGTH = 512;
export const MAX_FRAGMENT_TOKENS = 32;

export const ERROR_CODES = Object.freeze({
  NETWORK: "NETWORK",
  HTTP: "HTTP",
  JSON: "JSON",
  CONTRACT: "CONTRACT",
  UNKNOWN_MEMBER: "UNKNOWN_MEMBER",
  CELL_LIMIT: "CELL_LIMIT",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
});

export class AppError extends Error {
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
  }
}

const REQUIRED_TEXT_FIELDS = ["id", "name", "role", "mission", "profile"];
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(code, message, options) {
  throw new AppError(code, message, options);
}

function assertSet(value, label) {
  if (!(value instanceof Set)) {
    fail(ERROR_CODES.INVALID_ARGUMENT, `${label} must be a Set.`);
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validateTeam(input) {
  if (!Array.isArray(input)) {
    fail(ERROR_CODES.CONTRACT, "Team data must be an array.");
  }
  if (input.length !== EXPECTED_TEAM_SIZE) {
    fail(
      ERROR_CODES.CONTRACT,
      `Team data must contain exactly ${EXPECTED_TEAM_SIZE} members.`,
    );
  }

  const ids = new Set();
  const names = new Set();

  return input.map((rawMember, index) => {
    if (!rawMember || typeof rawMember !== "object" || Array.isArray(rawMember)) {
      fail(ERROR_CODES.CONTRACT, `Member at index ${index} must be an object.`);
    }

    const member = {};
    for (const field of REQUIRED_TEXT_FIELDS) {
      if (typeof rawMember[field] !== "string" || rawMember[field].trim() === "") {
        fail(ERROR_CODES.CONTRACT, `Member at index ${index} has an invalid ${field}.`);
      }
      member[field] = rawMember[field].trim();
    }

    if (!ID_PATTERN.test(member.id)) {
      fail(ERROR_CODES.CONTRACT, `Member at index ${index} has an invalid id.`);
    }
    if (ids.has(member.id)) {
      fail(ERROR_CODES.CONTRACT, `Duplicate member id: ${member.id}.`);
    }
    if (names.has(member.name)) {
      fail(ERROR_CODES.CONTRACT, `Duplicate member name: ${member.name}.`);
    }

    if (!Array.isArray(rawMember.expertise) || rawMember.expertise.length === 0) {
      fail(ERROR_CODES.CONTRACT, `Member at index ${index} must have expertise.`);
    }
    const expertise = rawMember.expertise.map((value) => {
      if (typeof value !== "string" || value.trim() === "") {
        fail(ERROR_CODES.CONTRACT, `Member at index ${index} has invalid expertise.`);
      }
      return value.trim();
    });
    if (new Set(expertise).size !== expertise.length) {
      fail(ERROR_CODES.CONTRACT, `Member at index ${index} has duplicate expertise.`);
    }

    ids.add(member.id);
    names.add(member.name);
    return Object.freeze({ ...member, expertise: Object.freeze(expertise) });
  });
}

export function normalizeQuery(value) {
  if (typeof value !== "string") {
    fail(ERROR_CODES.INVALID_ARGUMENT, "Query must be a string.");
  }
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de")
    .trim()
    .replace(/\s+/g, " ");
}

export function listExpertise(members) {
  if (!Array.isArray(members)) {
    fail(ERROR_CODES.INVALID_ARGUMENT, "Members must be an array.");
  }
  return [...new Set(members.flatMap((member) => member.expertise))].sort(compareText);
}

export function filterMembers(members, query = "", activeExpertise = new Set()) {
  if (!Array.isArray(members)) {
    fail(ERROR_CODES.INVALID_ARGUMENT, "Members must be an array.");
  }
  assertSet(activeExpertise, "Active expertise");
  const needle = normalizeQuery(query);

  return members.filter((member) => {
    const searchable = normalizeQuery(
      [member.name, member.role, member.mission, member.profile].join(" "),
    );
    const matchesQuery = needle === "" || searchable.includes(needle);
    const matchesExpertise =
      activeExpertise.size === 0 ||
      member.expertise.some((value) => activeExpertise.has(value));
    return matchesQuery && matchesExpertise;
  });
}

export function toggleSelection(selectedIds, memberId, members) {
  assertSet(selectedIds, "Selected ids");
  if (typeof memberId !== "string" || !Array.isArray(members)) {
    fail(ERROR_CODES.INVALID_ARGUMENT, "A member id and members array are required.");
  }
  if (!members.some((member) => member.id === memberId)) {
    fail(ERROR_CODES.UNKNOWN_MEMBER, `Unknown member id: ${memberId}.`);
  }

  const next = new Set(selectedIds);
  if (next.has(memberId)) {
    next.delete(memberId);
    return next;
  }
  if (next.size >= MAX_CELL_SIZE) {
    fail(
      ERROR_CODES.CELL_LIMIT,
      `A work cell may contain at most ${MAX_CELL_SIZE} members.`,
    );
  }
  next.add(memberId);
  return next;
}

export function clearDiscovery(state) {
  return { ...state, query: "", activeExpertise: new Set() };
}

export function clearCell(state) {
  return { ...state, selectedIds: new Set() };
}

function memberIds(members) {
  if (!Array.isArray(members)) {
    fail(ERROR_CODES.INVALID_ARGUMENT, "Members must be an array.");
  }
  return new Set(members.map((member) => member.id));
}

export function serializeCell(selectedIds, members) {
  assertSet(selectedIds, "Selected ids");
  const knownIds = memberIds(members);
  const ids = [];
  for (const id of selectedIds) {
    if (knownIds.has(id) && ids.length < MAX_CELL_SIZE) ids.push(id);
  }
  return `#cell=${ids.map((id) => encodeURIComponent(id)).join(",")}`;
}

export function restoreCell(fragment, members) {
  const result = {
    selectedIds: new Set(),
    ignored: { unknown: 0, duplicate: 0, overflow: 0 },
    hasCell: false,
    invalid: false,
  };
  const knownIds = memberIds(members);
  if (typeof fragment !== "string") {
    result.invalid = true;
    return result;
  }
  if (!fragment.startsWith("#cell=")) return result;
  result.hasCell = true;
  const rawValue = fragment.slice("#cell=".length);
  if (fragment.length > MAX_FRAGMENT_LENGTH || rawValue.split(",").length > MAX_FRAGMENT_TOKENS) {
    result.invalid = true;
    return result;
  }
  const seen = new Set();
  for (const rawId of rawValue.split(",")) {
    if (rawId === "") continue;
    let id;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      result.invalid = true;
      result.selectedIds = new Set();
      return result;
    }
    if (seen.has(id)) result.ignored.duplicate += 1;
    else if (!knownIds.has(id)) {
      seen.add(id);
      result.ignored.unknown += 1;
    } else if (result.selectedIds.size >= MAX_CELL_SIZE) {
      seen.add(id);
      result.ignored.overflow += 1;
    } else {
      seen.add(id);
      result.selectedIds.add(id);
    }
  }
  return result;
}
