export const MAX_CELL_SIZE = 4;
export const EXPECTED_TEAM_SIZE = 12;

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
