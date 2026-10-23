type OrderableWorkflowStep = {
  stageKey?: unknown;
  stageOrder?: unknown;
  order?: unknown;
};

type WorkflowOrderTemplate = {
  stages?: Array<{ key?: string; order?: number }>;
} | null | undefined;

/**
 * Mirrors the API's template-backed Key Action order. The Case Workspace must
 * derive its lock state from this sequence so a stale instance `stageOrder`
 * never contradicts the stage order the member can see on screen.
 */
export const orderWorkflowSteps = <T extends OrderableWorkflowStep>(
  steps: T[] | undefined,
  template?: WorkflowOrderTemplate
): T[] => {
  const source = Array.isArray(steps) ? steps : [];
  const stageRanks = new Map<string, number>();
  (template?.stages || [])
    .slice()
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
    .forEach((stage, index) => {
      const key = String(stage.key || '').trim();
      if (key && !stageRanks.has(key)) stageRanks.set(key, index);
    });

  const templateRankOf = (step: T) => stageRanks.get(String(step.stageKey || '').trim());
  const storedRankOf = (step: T) => {
    const rank = Number(step.stageOrder);
    return Number.isFinite(rank) ? rank : undefined;
  };
  const actionOrderOf = (step: T) => {
    const order = Number(step.order);
    return Number.isFinite(order) ? order : 0;
  };

  return source
    .map((step, index) => ({ step, index }))
    .sort((left, right) => {
      const leftTemplateRank = templateRankOf(left.step);
      const rightTemplateRank = templateRankOf(right.step);
      const leftInTemplate = leftTemplateRank !== undefined;
      const rightInTemplate = rightTemplateRank !== undefined;

      if (leftInTemplate && rightInTemplate && leftTemplateRank !== rightTemplateRank) {
        return leftTemplateRank - rightTemplateRank;
      }
      if (leftInTemplate !== rightInTemplate) return leftInTemplate ? -1 : 1;

      if (!leftInTemplate) {
        const leftStoredRank = storedRankOf(left.step);
        const rightStoredRank = storedRankOf(right.step);
        if (leftStoredRank !== undefined && rightStoredRank !== undefined && leftStoredRank !== rightStoredRank) {
          return leftStoredRank - rightStoredRank;
        }
        if (leftStoredRank !== undefined && rightStoredRank === undefined) return -1;
        if (leftStoredRank === undefined && rightStoredRank !== undefined) return 1;
      }

      return actionOrderOf(left.step) - actionOrderOf(right.step) || left.index - right.index;
    })
    .map(({ step }) => step);
};
