/**
 * Shared presentation helpers for Workflow Key Actions, Outputs and Legal Basis.
 *
 * The stored business data is kept clean and reusable (no "1." prefixes, no
 * "•" characters). All numbering and bullet formatting is generated here so the
 * Workflow review table, the Excel export and the PDF export always agree.
 */

/** Split a multiline string into trimmed, non-empty lines/items. */
export const splitLines = (value: unknown): string[] =>
  String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

// Matches a manually-entered Key Action numbering prefix such as "1. ", "12. ",
// "1) " or "(1) ". Only this clear pattern is removed — numbers that are part of
// the wording itself (e.g. "Review Article 15 requirements") are never touched.
const MANUAL_NUMBER_PREFIX = /^(?:\(\d{1,3}\)|\d{1,3}[.)])\s+/;

/**
 * Remove a leading manually-entered numbering prefix from a Key Action.
 * Also collapses repeated prefixes ("1. 1. Text" → "Text") so the UI can never
 * produce "1. 1. …".
 */
export const stripKeyActionNumber = (value: unknown): string => {
  let text = String(value ?? '').trim();
  for (let guard = 0; guard < 5; guard += 1) {
    const next = text.replace(MANUAL_NUMBER_PREFIX, '');
    if (next === text) return text;
    text = next.trim();
  }
  return text;
};

/**
 * Format a single Key Action with its automatically generated position number.
 * The number is derived from the Key Action's order in the workflow — it is
 * never stored or entered manually.
 */
export const numberedKeyAction = (value: unknown, number: number): string =>
  `${number}. ${stripKeyActionNumber(value)}`;

/**
 * Build bullet-point lines for downloadable files (Excel / PDF). Every non-empty
 * line becomes its own bullet. Lines that already start with a bullet character
 * are left untouched to avoid "• • …". A single item is returned as plain text.
 */
export const bulletLines = (value: unknown): string => {
  const items = splitLines(value);
  if (items.length <= 1) return items.join('');
  return items.map((item) => (/^[•·\-*]\s+/.test(item) ? item : `• ${item}`)).join('\n');
};
