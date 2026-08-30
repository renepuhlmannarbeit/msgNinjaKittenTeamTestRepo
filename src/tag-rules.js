export function tagComparisonKey(value) {
  // NFC preserves compatibility distinctions; ordinary Unicode case mapping
  // intentionally still equates characters such as ſ, ﬃ, and fullwidth Latin.
  return value.trim().normalize("NFC").toUpperCase().toLowerCase();
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
