export function tagComparisonKey(value) {
  // NFC equates canonically identical spellings only. Uppercase before
  // lowercasing maps ß to SS without applying compatibility folding.
  return value.normalize("NFC").toUpperCase().toLowerCase();
}
