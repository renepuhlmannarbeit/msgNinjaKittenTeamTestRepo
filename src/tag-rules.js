export function tagComparisonKey(value) {
  // NFC equates canonical spellings only. Protect every compatibility
  // character before case mapping: case mappings otherwise turn ſ into s and
  // ﬃ into ffi even without an explicit NFKC/NFKD call.
  return [...value.trim().normalize("NFC")].map((character) =>
    character.normalize("NFKC") === character
      ? character.toUpperCase().toLowerCase().replaceAll("\\", "\\\\")
      : `\\u{${character.codePointAt(0).toString(16)}}`,
  ).join("");
}

export function tagComparisonIncludes(value, query) {
  const key = tagComparisonKey(value);
  const needle = tagComparisonKey(query);
  let start = key.indexOf(needle);
  while (start !== -1) {
    const next = key.slice(start + needle.length, start + needle.length + 2);
    if (!/^\p{Mark}/u.test(next)) return true;
    start = key.indexOf(needle, start + 1);
  }
  return false;
}
