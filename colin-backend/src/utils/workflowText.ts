/**
 * Shared server-side helpers for keeping workflow template text clean.
 *
 * Key Action numbers and bullet characters are presentation concerns — they
 * must never be stored as part of the business data. These helpers remove any
 * manually-entered numbering prefixes that may exist in legacy records.
 */

// Matches a manually-entered Key Action numbering prefix such as "1. ", "12. ",
// "1) " or "(1) ". Only this clear pattern is removed — numbers that are part
// of the wording itself (e.g. "Review Article 15 requirements") are untouched.
const MANUAL_NUMBER_PREFIX = /^(?:\(\d{1,3}\)|\d{1,3}[.)])\s+/;

export const stripManualNumberPrefix = (value: unknown): string => {
  let text = String(value ?? '').trim();
  // Loop so "1. 1. Text" collapses to "Text".
  for (let guard = 0; guard < 5; guard += 1) {
    const next = text.replace(MANUAL_NUMBER_PREFIX, '');
    if (next === text) return text;
    text = next.trim();
  }
  return text;
};

/**
 * Normalize a template document/payload in place: every Key Action (and step
 * title used as a fallback action) has manual "N. " prefixes removed.
 */
export const normalizeTemplateActionText = (template: any): any => {
  if (!template) return template;
  if (Array.isArray(template.steps)) {
    template.steps = template.steps.map((step: any) => {
      if (!step || typeof step !== 'object') return step;
      const normalized: any = { ...step };
      if (Array.isArray(normalized.actions)) {
        normalized.actions = normalized.actions.map((action: any) => stripManualNumberPrefix(action));
      }
      if (typeof normalized.title === 'string') {
        normalized.title = stripManualNumberPrefix(normalized.title);
      }
      return normalized;
    });
  }
  return template;
};
