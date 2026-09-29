/**
 * Deterministic workflow-template matching.
 *
 * A matter type + case type can exist more than once in the templates
 * collection (older seed runs, versioned re-imports, restored snapshots).
 * Matching with "the first document found" made different screens pick
 * different templates: a case workspace could show one template's Key Actions
 * while Templates settings showed another. The canonical copy is always the
 * one the firm maintains:
 *
 *   1. published (active and not a draft) wins over retired/draft copies;
 *   2. the newest version wins;
 *   3. the most recently updated document wins.
 *
 * Every resolver (case creation, case workspace, workflow self-heal, repair
 * scripts) uses this module so a matter type always resolves to the same,
 * maintained template.
 */

export const normalizeTemplateMatchValue = (value: unknown) =>
  String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export const templateCanonicalGroupKey = (matterType: unknown, caseType: unknown) =>
  `${normalizeTemplateMatchValue(matterType)}|${String(caseType ?? '').trim()}`;

const templateRank = (template: any): [number, number, number] => [
  template?.active && !template?.draft ? 1 : 0,
  Number(template?.version) || 0,
  new Date(template?.updatedAt ?? 0).getTime() || 0,
];

/** Negative when `a` is the better (canonical) candidate. */
export const compareWorkflowTemplateRank = (a: any, b: any): number => {
  const rankA = templateRank(a);
  const rankB = templateRank(b);
  for (let index = 0; index < rankA.length; index += 1) {
    const valueA = rankA[index] ?? 0;
    const valueB = rankB[index] ?? 0;
    if (valueA !== valueB) return valueA > valueB ? -1 : 1;
  }
  return 0;
};

const bestOf = (templates: any[]): any | null => {
  let best: any = null;
  for (const template of templates) {
    if (!best || compareWorkflowTemplateRank(template, best) < 0) best = template;
  }
  return best;
};

/** One canonical template per normalized matter type + case type group. */
export const buildCanonicalTemplateIndex = (templates: any[]): Map<string, any> => {
  const index = new Map<string, any>();
  for (const template of Array.isArray(templates) ? templates : []) {
    const key = templateCanonicalGroupKey(template?.matterType, template?.caseType);
    const current = index.get(key);
    if (!current || compareWorkflowTemplateRank(template, current) < 0) index.set(key, template);
  }
  return index;
};

/**
 * Resolve one template by matter type (or name) and case type. Published
 * templates are preferred; when none is published the best draft is returned so
 * a partially-configured environment still behaves predictably.
 */
export const resolveCanonicalTemplate = (
  templates: any[],
  options: { matterType?: unknown; caseType?: unknown; name?: unknown }
): any | null => {
  const wantedMatter = normalizeTemplateMatchValue(options?.matterType);
  const wantedName = normalizeTemplateMatchValue(options?.name);
  if (!wantedMatter && !wantedName) return null;
  const caseType = String(options?.caseType ?? '').trim();

  const matching = (Array.isArray(templates) ? templates : []).filter((template) => {
    const matterHit = Boolean(wantedMatter) && normalizeTemplateMatchValue(template?.matterType) === wantedMatter;
    const nameHit = Boolean(wantedName) && normalizeTemplateMatchValue(template?.name) === wantedName;
    if (!matterHit && !nameHit) return false;
    if (!caseType) return true;
    return String(template?.caseType ?? '').trim() === caseType;
  });

  const published = matching.filter((template) => template?.active && !template?.draft);
  return bestOf(published.length ? published : matching);
};

/**
 * Resolve the template a case must follow:
 * matter type + case type first, then the template name (legacy cases stored a
 * template name in their workflow label), then matter type alone when only one
 * case type defines it.
 */
export const resolveCanonicalTemplateForCase = (
  templates: any[],
  labels: { matterType?: unknown; caseType?: unknown; name?: unknown }
): any | null => {
  const direct = resolveCanonicalTemplate(templates, labels);
  if (direct) return direct;

  const byName = resolveCanonicalTemplate(templates, { name: labels?.name, caseType: labels?.caseType });
  if (byName) return byName;

  const wantedMatter = normalizeTemplateMatchValue(labels?.matterType);
  if (!wantedMatter) return null;
  const matches = (Array.isArray(templates) ? templates : []).filter(
    (template) => normalizeTemplateMatchValue(template?.matterType) === wantedMatter
  );
  if (!matches.length) return null;
  // Only when the matter type itself is unambiguous across case types.
  const caseTypes = new Set(matches.map((template) => String(template?.caseType ?? '').trim()));
  if (caseTypes.size > 1) return null;
  const published = matches.filter((template) => template?.active && !template?.draft);
  return bestOf(published.length ? published : matches);
};
