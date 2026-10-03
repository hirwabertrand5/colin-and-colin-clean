/**
 * Align a live case workflow with its canonical template.
 *
 * This is the repair path used when a case was created against a template that
 * has since been deleted, replaced or duplicated. The case checklist is
 * rebuilt from the template so the Case Workspace always shows exactly the Key
 * Actions defined in Templates settings, while nothing that carries progress is
 * destroyed:
 *
 * - completed ticks follow their action TEXT (never a position), so a reorder
 *   or re-wording can never move finished work to another key action;
 * - a step keeps its own deadline, status, completion stamp and extensions;
 * - a Key Action that exists only on the case survives when it is ticked;
 * - an unticked leftover of an older template is dropped — that leftover is
 *   exactly the drift this alignment removes;
 * - a whole step that is not in the template is ARCHIVED, not listed: it leaves
 *   the active checklist (so the Case Workspace, Case Management and the earned
 *   fees only ever show the current template's stages and Key Actions) while the
 *   full record is returned so it can be stored on `archivedSteps` and is never
 *   destroyed. Carrying it in the active list is what used to double-count a
 *   superseded template against the contract value;
 * - percentages absent from the template never zero a value the case already
 *   stores (the same rule the normal template sync applies).
 */

import { buildInstanceSteps } from './workflowCompute';
import { parsePercentage } from './workflowPercentages';
import { stripManualNumberPrefix } from './workflowText';

const actionKey = (value: unknown) =>
  stripManualNumberPrefix(value).replace(/\s+/g, ' ').trim().toLowerCase();

const tokenize = (value: unknown) =>
  new Set(
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter((word) => word.length > 2)
  );

/** Token-overlap similarity, 0–1. Used only to propose a carry-forward. */
const similarity = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
};

export type CarriedProgress = {
  templateStepKey: string;
  actionText: string;
  /** The superseded/previous wording this tick was carried over from. */
  fromText: string;
  score: number;
};

/**
 * Collect every Key Action that was already ticked anywhere on the matter —
 * including steps from a superseded template — so that work is never silently
 * lost when the checklist is rebuilt from the current template.
 */
export const collectCompletedActionTexts = (steps: any[] | undefined): Array<{ text: string; doneAt?: any }> => {
  const pool: Array<{ text: string; doneAt?: any }> = [];
  const seen = new Set<string>();
  for (const step of Array.isArray(steps) ? steps : []) {
    for (const action of Array.isArray(step?.actions) ? step.actions : []) {
      if (!action?.done) continue;
      const text = String(action?.text || '').trim();
      const key = actionKey(text);
      if (!text || !key || seen.has(key)) continue;
      seen.add(key);
      pool.push({ text, doneAt: action?.doneAt });
    }
  }
  return pool;
};

/**
 * Propose, for one unticked template Key Action, the previously ticked wording it
 * most likely supersedes. Deliberately conservative: an exact normalised match
 * always wins, and a fuzzy match must clear the threshold AND be a clear single
 * winner. Anything ambiguous returns null so it is reported for a human instead of
 * being guessed at.
 */
export const proposeCarryForward = (
  actionText: unknown,
  pool: Array<{ text: string; doneAt?: any }>,
  threshold = 0.62
): { text: string; doneAt?: any; score: number } | null => {
  const target = actionKey(actionText);
  if (!target) return null;
  for (const candidate of pool) {
    if (actionKey(candidate.text) === target) return { ...candidate, score: 1 };
  }
  const targetTokens = tokenize(actionText);
  if (!targetTokens.size) return null;
  const scored = pool
    .map((candidate) => ({ candidate, score: similarity(targetTokens, tokenize(candidate.text)) }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  // Ambiguous (two different wordings equally plausible) -> do not guess.
  if (scored.length > 1 && Math.abs(scored[0]!.score - scored[1]!.score) < 0.15) return null;
  return { ...scored[0]!.candidate, score: scored[0]!.score };
};

export type WorkflowAlignmentSummary = {
  templateSteps: number;
  matchedSteps: number;
  addedTemplateSteps: number;
  addedActions: number;
  droppedSteps: string[];
  droppedActions: string[];
  keptLegacySteps: string[];
  keptLegacyActions: string[];
  /** Ticks carried onto the current template's Key Actions from older wording. */
  carriedProgress: CarriedProgress[];
  /** Previously ticked wording that maps to no current Key Action (review these). */
  unmatchedProgress: string[];
};

export type WorkflowAlignmentResult = {
  /** The active checklist — exactly the template's stages and Key Actions. */
  steps: any[];
  /** Superseded steps, preserved so the caller can archive rather than lose them. */
  archivedSteps: any[];
  summary: WorkflowAlignmentSummary;
};

/**
 * True when the case carries a step the template no longer defines. A matter can
 * drift like this while still being linked to the canonical template (an earlier
 * alignment kept the old steps), so this is what lets the repair run again.
 */
export const hasSupersededTemplateSteps = (existingSteps: any[] | undefined, template: any): boolean => {
  const templateKeys = new Set(
    (Array.isArray(template?.steps) ? template.steps : []).map((step: any) => String(step?.key || ''))
  );
  if (!templateKeys.size) return false;
  return (Array.isArray(existingSteps) ? existingSteps : []).some(
    (step: any) => !templateKeys.has(String(step?.stepKey || ''))
  );
};

export const alignInstanceStepsToTemplate = (
  existingSteps: any[] | undefined,
  template: any,
  startDate: Date,
  options: { keepLegacyProgress?: boolean } = {}
): WorkflowAlignmentResult => {
  const keepLegacyProgress = options.keepLegacyProgress !== false;
  const builtSteps = buildInstanceSteps(template, startDate);
  const previousByKey = new Map<string, any>(
    (Array.isArray(existingSteps) ? existingSteps : []).map((step: any) => [String(step?.stepKey || ''), step])
  );
  const templateStepByKey = new Map<string, any>(
    (Array.isArray(template?.steps) ? template.steps : []).map((step: any) => [String(step?.key || ''), step])
  );
  const templateStageByKey = new Map<string, any>(
    (Array.isArray(template?.stages) ? template.stages : []).map((stage: any) => [String(stage?.key || ''), stage])
  );

  const summary: WorkflowAlignmentSummary = {
    templateSteps: builtSteps.length,
    matchedSteps: 0,
    addedTemplateSteps: 0,
    addedActions: 0,
    droppedSteps: [],
    droppedActions: [],
    keptLegacySteps: [],
    keptLegacyActions: [],
    carriedProgress: [],
    unmatchedProgress: [],
  };

  // Every tick the matter has ever earned, wherever it was recorded. Rebuilding
  // the checklist from the template must never quietly undo finished work, so an
  // unticked template Key Action adopts the wording it supersedes.
  const completedPool = collectCompletedActionTexts(existingSteps);
  const claimed = new Set<string>();
  const carriedProgress: CarriedProgress[] = [];

  const steps: any[] = builtSteps.map((templateStep: any) => {
    const previous: any = previousByKey.get(String(templateStep.stepKey));
    if (previous) summary.matchedSteps += 1;
    else summary.addedTemplateSteps += 1;

    // Queue previous ticks per normalized action text so repeated checklist
    // items keep their own tick.
    const remaining = new Map<string, any[]>();
    for (const action of Array.isArray(previous?.actions) ? previous.actions : []) {
      const key = actionKey(action?.text);
      if (!key) continue;
      const queue = remaining.get(key) || [];
      queue.push(action);
      remaining.set(key, queue);
    }

    const mergedActions: any[] = (templateStep.actions || []).map((action: any) => {
      const text = stripManualNumberPrefix(action?.text);
      const key = actionKey(text);
      const queue = remaining.get(key) || [];
      const matched = queue.shift();
      if (queue.length) remaining.set(key, queue);
      else remaining.delete(key);

      // No tick on this very step: adopt one recorded elsewhere on the matter
      // (typically under an older template's wording) when it is unambiguous.
      if (!matched?.done) {
        const proposal = proposeCarryForward(
          text,
          completedPool.filter((entry) => !claimed.has(actionKey(entry.text)))
        );
        if (proposal) {
          claimed.add(actionKey(proposal.text));
          carriedProgress.push({
            templateStepKey: String(templateStep.stepKey),
            actionText: text,
            fromText: proposal.text,
            score: proposal.score,
          });
          return { text, done: true, ...(proposal.doneAt ? { doneAt: proposal.doneAt } : {}) };
        }
      }

      if (!matched) summary.addedActions += 1;
      return {
        text,
        done: Boolean(matched?.done),
        ...(matched?.doneAt ? { doneAt: matched.doneAt } : {}),
      };
    });

    for (const queue of remaining.values()) {
      for (const action of queue) {
        const text = String(action?.text || '').trim();
        if (!text) continue;
        if (!action?.done || !keepLegacyProgress) {
          summary.droppedActions.push(`${templateStep.stepKey} :: ${text}`);
          continue;
        }
        mergedActions.push({ text, done: true, ...(action?.doneAt ? { doneAt: action.doneAt } : {}) });
        summary.keptLegacyActions.push(`${templateStep.stepKey} :: ${text}`);
      }
    }

    const templateStepPercentage = parsePercentage(templateStepByKey.get(String(templateStep.stepKey))?.percentage);
    const templateStagePercentage = parsePercentage(templateStageByKey.get(String(templateStep.stageKey))?.percentage);

    return {
      ...templateStep,
      // A live step keeps its own deadline; only brand-new steps get fresh ones.
      startAt: previous?.startAt ? new Date(previous.startAt) : templateStep.startAt,
      dueAt: previous?.dueAt ? new Date(previous.dueAt) : templateStep.dueAt,
      percentage:
        templateStepPercentage === undefined && Number(previous?.percentage) > 0
          ? Number(previous.percentage)
          : templateStep.percentage,
      stagePercentage:
        templateStagePercentage === undefined && Number(previous?.stagePercentage) > 0
          ? Number(previous.stagePercentage)
          : templateStep.stagePercentage,
      status: previous?.status || templateStep.status,
      completedAt: previous?.completedAt,
      submittedAt: previous?.submittedAt,
      reviewedAt: previous?.reviewedAt,
      extensionHistory: Array.isArray(previous?.extensionHistory) ? previous.extensionHistory : [],
      actions: mergedActions,
      outputs: templateStep.outputs,
    };
  });

  // Steps the template no longer defines are removed from the active checklist
  // and returned separately so the caller can archive them. `keepLegacyProgress`
  // now only decides whether an unticked leftover is discarded outright or
  // archived too — either way it never stays on the checklist.
  const builtKeys = new Set(builtSteps.map((step: any) => String(step?.stepKey || '')));
  const archivedSteps: any[] = [];
  for (const step of Array.isArray(existingSteps) ? existingSteps : []) {
    const stepKey = String(step?.stepKey || '');
    if (builtKeys.has(stepKey)) continue;
    const label = `${stepKey} :: ${String(step?.title || '')}`.trim();
    const hasCompletedAction = (Array.isArray(step?.actions) ? step.actions : []).some((action: any) => action?.done);
    const isCompleted = String(step?.status || '') === 'Completed';
    // A leftover with no progress at all carries no history worth keeping, so it
    // is always simply dropped. `keepLegacyProgress` only decides the fate of
    // superseded work that DOES carry progress: archived (the default, so it is
    // preserved off the checklist) or discarded when the caller explicitly opts
    // into pruning.
    if (!hasCompletedAction && !isCompleted) {
      summary.droppedSteps.push(label);
      continue;
    }
    if (!keepLegacyProgress) {
      summary.droppedSteps.push(label);
      continue;
    }
    archivedSteps.push({ ...step, archivedFromTemplate: true, archivedAt: new Date() });
    summary.keptLegacySteps.push(label);
  }

  return { steps, archivedSteps, summary: {
    ...summary,
    carriedProgress,
    // Previously ticked wording that no current Key Action claims. Reported
    // rather than dropped, so a person can confirm the intent — the record is
    // still preserved on the archived steps.
    unmatchedProgress: completedPool
      .filter((entry) => !claimed.has(actionKey(entry.text)))
      .map((entry) => entry.text),
  } };
};

