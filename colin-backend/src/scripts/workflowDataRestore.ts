/**
 * Workflow data recovery for live matters.
 *
 * Case workflows snapshot their Key Actions (checklist items), step
 * percentages and stage percentages from the template. Older versions of the
 * template sync could drop some of that data. This module finds data that
 * still exists in the template but is missing on the case, and puts it back.
 *
 * Safety rules:
 * - Only missing data is added. Nothing is deleted, renamed or re-checked:
 *   done flags, statuses, due dates and case-specific Key Actions are kept.
 * - Closed/completed matters are never touched — their workflow is a terminal
 *   snapshot.
 * - A stored 0% is only replaced when the whole instance has no usable
 *   percentages at all (a legacy instance created before percentages existed).
 *   That mirrors the rule the earned-fee report already applies when reading
 *   such instances. Other 0% values are reported for review instead of being
 *   overwritten.
 */

import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';
import { isWorkflowInstanceCompleted, updateCaseWorkflowProgress } from '../controllers/workflowController';
import { parsePercentage } from '../utils/workflowPercentages';
import { stripManualNumberPrefix } from '../utils/workflowText';

export type WorkflowDataGap = {
  caseId: string;
  caseNo: string;
  parties: string;
  terminal: boolean;
  templateMissing: boolean;
  legacyPercentages: boolean;
  actionsToAdd: number;
  stepPercentagesToFill: number;
  stagePercentagesToFill: number;
  stageTitlesToFill: number;
  templateOnlySteps: number;
  zeroPercentagesForReview: number;
  samples: string[];
};

type StepAnalysis = {
  missingActions: string[];
  fillStepPercentage: number | undefined;
  fillStagePercentage: number | undefined;
  fillStageTitle: string | undefined;
  zeroPercentageForReview: number | undefined;
};

/** Match Key Actions regardless of manually entered numbering ("1. Text"). */
const normalizeActionKey = (value: unknown) =>
  stripManualNumberPrefix(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const asMap = (items: any[], keyOf: (item: any) => string) =>
  new Map<string, any>(items.map((item: any) => [keyOf(item), item] as [string, any]));

/**
 * Compare one case step to its template step. Only additions are reported:
 * which template Key Actions are missing from the case checklist, and which
 * percentage fields can be filled back in.
 */
const analyzeStep = (
  step: any,
  templateStep: any,
  templateStage: any,
  legacyPercentages: boolean
): StepAnalysis => {
  const missingActions: string[] = [];
  if (templateStep) {
    // Count occurrences per text so repeated checklist items are restored
    // exactly as often as the template defines them.
    const counts = new Map<string, number>();
    for (const action of Array.isArray(step?.actions) ? step.actions : []) {
      const key = normalizeActionKey(action?.text);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const rawAction of Array.isArray(templateStep.actions) ? templateStep.actions : []) {
      const text = stripManualNumberPrefix(rawAction);
      const key = normalizeActionKey(text);
      if (!key) continue;
      const remaining = counts.get(key) || 0;
      if (remaining > 0) {
        counts.set(key, remaining - 1);
        continue;
      }
      missingActions.push(text);
    }
  }

  const templateStepPercentage = parsePercentage(templateStep?.percentage);
  const templateStagePercentage = parsePercentage(templateStage?.percentage);

  const storedStepPercentage = step?.percentage;
  const stepPercentageMissing = storedStepPercentage === undefined || storedStepPercentage === null;
  let fillStepPercentage: number | undefined;
  let zeroPercentageForReview: number | undefined;
  if (stepPercentageMissing) {
    fillStepPercentage = templateStepPercentage;
  } else if (Number(storedStepPercentage) === 0 && templateStepPercentage) {
    if (legacyPercentages) fillStepPercentage = templateStepPercentage;
    else zeroPercentageForReview = templateStepPercentage;
  }

  const storedStagePercentage = step?.stagePercentage;
  const stagePercentageMissing = storedStagePercentage === undefined || storedStagePercentage === null;
  let fillStagePercentage: number | undefined;
  if (stagePercentageMissing) {
    fillStagePercentage = templateStagePercentage;
  } else if (Number(storedStagePercentage) === 0 && legacyPercentages && templateStagePercentage) {
    fillStagePercentage = templateStagePercentage;
  }

  const fillStageTitle =
    !String(step?.stageTitle || '').trim() && templateStage?.title ? String(templateStage.title) : undefined;

  return { missingActions, fillStepPercentage, fillStagePercentage, fillStageTitle, zeroPercentageForReview };
};

export const loadWorkflowTemplatesById = async (): Promise<Map<string, any>> => {
  const templates: any[] = await WorkflowTemplate.find({}).lean();
  return asMap(templates, (template: any) => String(template?._id));
};

/**
 * Read-only pass: report every matter whose workflow is missing Key Actions or
 * percentage data that the template still defines.
 */
export const scanWorkflowDataGaps = (
  cases: any[],
  instanceByCaseId: Map<string, any>,
  templateById: Map<string, any>
): WorkflowDataGap[] => {
  const gaps: WorkflowDataGap[] = [];

  for (const c of cases) {
    const inst: any = instanceByCaseId.get(String(c._id));
    if (!inst) continue;

    const caseStatus = String(c.status || '').trim().toLowerCase();
    const workflowStatus = String(c.workflowProgress?.status || '').trim();
    const terminal =
      caseStatus === 'closed' || workflowStatus === 'Completed' || isWorkflowInstanceCompleted(inst);
    const template: any = templateById.get(String(inst.templateId));
    const templateMissing = !template;

    const gap: WorkflowDataGap = {
      caseId: String(c._id),
      caseNo: String(c.caseNo || 'N/A'),
      parties: String(c.parties || ''),
      terminal,
      templateMissing,
      legacyPercentages: false,
      actionsToAdd: 0,
      stepPercentagesToFill: 0,
      stagePercentagesToFill: 0,
      stageTitlesToFill: 0,
      templateOnlySteps: 0,
      zeroPercentagesForReview: 0,
      samples: [],
    };

    if (template) {
      const steps: any[] = Array.isArray(inst.steps) ? inst.steps : [];
      gap.legacyPercentages = steps.length > 0 && !steps.some((step: any) => Number(step?.percentage) > 0);
      const stageByKey = asMap(Array.isArray(template.stages) ? template.stages : [], (stage: any) =>
        String(stage?.key || '')
      );
      const templateStepByKey = asMap(Array.isArray(template.steps) ? template.steps : [], (step: any) =>
        String(step?.key || '')
      );

      for (const step of steps) {
        const analysis = analyzeStep(
          step,
          templateStepByKey.get(String(step?.stepKey)),
          stageByKey.get(String(step?.stageKey)),
          gap.legacyPercentages
        );
        gap.actionsToAdd += analysis.missingActions.length;
        if (analysis.fillStepPercentage !== undefined) gap.stepPercentagesToFill += 1;
        if (analysis.fillStagePercentage !== undefined) gap.stagePercentagesToFill += 1;
        if (analysis.fillStageTitle) gap.stageTitlesToFill += 1;
        if (analysis.zeroPercentageForReview !== undefined) {
          gap.zeroPercentagesForReview += 1;
          if (gap.samples.length < 6) {
            gap.samples.push(
              `${step?.stepKey}: percentage is 0 while the workflow defines ${analysis.zeroPercentageForReview}%`
            );
          }
        }
        for (const text of analysis.missingActions) {
          if (gap.samples.length < 6) gap.samples.push(`${step?.stepKey}: + "${text}"`);
        }
      }

      const instanceStepKeys = new Set(steps.map((step: any) => String(step?.stepKey)));
      gap.templateOnlySteps = (Array.isArray(template.steps) ? template.steps : []).filter(
        (templateStep: any) => !instanceStepKeys.has(String(templateStep?.key))
      ).length;
    }

    const hasIssue =
      gap.templateMissing ||
      gap.actionsToAdd > 0 ||
      gap.stepPercentagesToFill > 0 ||
      gap.stagePercentagesToFill > 0 ||
      gap.stageTitlesToFill > 0 ||
      gap.templateOnlySteps > 0 ||
      gap.zeroPercentagesForReview > 0;
    if (hasIssue) gaps.push(gap);
  }

  return gaps;
};

export type WorkflowDataRestoreResult = {
  restored: any[];
  skipped: any[];
};

/**
 * Apply the additive restoration for the given gaps. Every record is re-read
 * right before it is changed and the terminal-state guard is checked again, so
 * a matter that became closed after the scan is left untouched.
 */
export const restoreWorkflowDataGaps = async (
  gaps: WorkflowDataGap[],
  templateById: Map<string, any>
): Promise<WorkflowDataRestoreResult> => {
  const restored: any[] = [];
  const skipped: any[] = [];

  for (const gap of gaps) {
    if (gap.terminal) {
      skipped.push({ caseId: gap.caseId, caseNo: gap.caseNo, reason: 'Matter is closed/completed (terminal snapshot)' });
      continue;
    }
    if (gap.templateMissing) {
      skipped.push({ caseId: gap.caseId, caseNo: gap.caseNo, reason: 'Workflow template no longer exists' });
      continue;
    }

    const [caseDoc, inst]: any[] = await Promise.all([
      Case.findById(gap.caseId),
      WorkflowInstance.findOne({ caseId: gap.caseId }),
    ]);
    if (!caseDoc || !inst) {
      skipped.push({ caseId: gap.caseId, caseNo: gap.caseNo, reason: 'Record no longer exists' });
      continue;
    }

    const caseStatus = String(caseDoc.status || '').trim().toLowerCase();
    if (
      caseStatus === 'closed' ||
      String(caseDoc.workflowProgress?.status || '').trim() === 'Completed' ||
      isWorkflowInstanceCompleted(inst)
    ) {
      skipped.push({ caseId: gap.caseId, caseNo: gap.caseNo, reason: 'Matter became closed/completed' });
      continue;
    }

    const template: any = templateById.get(String(inst.templateId));
    if (!template) {
      skipped.push({ caseId: gap.caseId, caseNo: gap.caseNo, reason: 'Workflow template no longer exists' });
      continue;
    }

    const steps: any[] = Array.isArray(inst.steps) ? inst.steps : [];
    const legacyPercentages = steps.length > 0 && !steps.some((step: any) => Number(step?.percentage) > 0);
    const stageByKey = asMap(Array.isArray(template.stages) ? template.stages : [], (stage: any) =>
      String(stage?.key || '')
    );
    const templateStepByKey = asMap(Array.isArray(template.steps) ? template.steps : [], (step: any) =>
      String(step?.key || '')
    );

    let actionsAdded = 0;
    let stepPercentagesFilled = 0;
    let stagePercentagesFilled = 0;
    let stageTitlesFilled = 0;

    for (const step of steps) {
      const analysis = analyzeStep(
        step,
        templateStepByKey.get(String(step?.stepKey)),
        stageByKey.get(String(step?.stageKey)),
        legacyPercentages
      );
      if (analysis.missingActions.length) {
        if (!Array.isArray(step.actions)) step.actions = [];
        for (const text of analysis.missingActions) step.actions.push({ text, done: false });
        actionsAdded += analysis.missingActions.length;
      }
      if (analysis.fillStepPercentage !== undefined) {
        step.percentage = analysis.fillStepPercentage;
        stepPercentagesFilled += 1;
      }
      if (analysis.fillStagePercentage !== undefined) {
        step.stagePercentage = analysis.fillStagePercentage;
        stagePercentagesFilled += 1;
      }
      if (analysis.fillStageTitle) {
        step.stageTitle = analysis.fillStageTitle;
        stageTitlesFilled += 1;
      }
    }

    if (!actionsAdded && !stepPercentagesFilled && !stagePercentagesFilled && !stageTitlesFilled) continue;

    await inst.save();

    // Percentages feed the matter's completion %, so keep the case record in
    // sync through the same function every workflow action uses.
    if (stepPercentagesFilled || stagePercentagesFilled) {
      await updateCaseWorkflowProgress(caseDoc, inst);
    }

    restored.push({
      caseId: gap.caseId,
      caseNo: gap.caseNo,
      actionsAdded,
      stepPercentagesFilled,
      stagePercentagesFilled,
      stageTitlesFilled,
    });
  }

  return { restored, skipped };
};
