/**
 * End-to-end verification for the workflow Key Action / percentage fixes.
 *
 * Checks:
 *  A. Workflow merge + completion logic (pure functions, no database).
 *     A template sync must never drop case Key Actions, ticks or percentages.
 *  B. API guards (exercised with mocked requests).
 *     Stale template saves must be rejected; closed matters cannot be reopened
 *     by a generic edit or by ticking a key action.
 *  C. Live database invariants.
 *     No completed workflow on a non-closed matter; no restorable Key Action /
 *     percentage data left.
 *  D. Executive dashboard.
 *     Pending follow-ups must exclude tasks whose matter is closed/completed.
 *
 * The script is read-only: the guard checks only exercise rejection paths
 * (which return before any save), and the audit endpoint is only expected to
 * report. Run with: npm run verify:workflows
 */
import 'dotenv/config';
import connectDB from '../config/db';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';
import Task from '../models/taskModel';
import {
  buildUpdatedInstanceSteps,
  isWorkflowInstanceCompleted,
  toggleStepAction,
  fixCaseWorkflowMismatches,
  updateTemplate,
} from '../controllers/workflowController';
import { updateCase } from '../controllers/caseController';
import { getExecutiveAssistantDashboard } from '../controllers/dashboardController';
import { computeCompletedPercentFromInstance } from '../utils/workflowPercentages';
import { loadWorkflowTemplatesById, scanWorkflowDataGaps } from './workflowDataRestore';

let passed = 0;
let failed = 0;

const check = (name: string, condition: boolean, detail?: unknown) => {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL  ${name}`);
  if (detail !== undefined) console.log('        ', JSON.stringify(detail));
};

const mockRes = () => {
  const captured: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(payload: any) {
      captured.body = payload;
      return res;
    },
  };
  return { res, captured };
};

const verifyMergeLogic = () => {
  const template = {
    stages: [
      { key: 'S1', title: 'Intake', percentage: 10 },
      { key: 'S2', title: 'Drafting' },
    ],
    steps: [
      { key: 'T1', order: 1, title: 'Collect facts', stageKey: 'S1', actions: ['Check facts', 'Check facts', 'Draft memo'], percentage: 25 },
      { key: 'T2', order: 2, title: 'Prepare draft', stageKey: 'S2', actions: ['Prepare draft'] },
      { key: 'T3', order: 3, title: 'Review draft', stageKey: 'S2', actions: ['Review draft'] },
    ],
  };
  const doneAt = new Date('2026-01-02T00:00:00Z');
  const existing = [
    {
      stepKey: 'T1', title: 'Collect facts', stageKey: 'S1', order: 1, status: 'In Progress', percentage: 30, stagePercentage: 7,
      actions: [
        { text: 'Check facts', done: true, doneAt },
        { text: 'Check facts', done: false },
        { text: 'Case-specific extra', done: true, doneAt },
      ],
    },
    {
      stepKey: 'T3', title: 'Review draft', stageKey: 'S2', order: 3, status: 'Awaiting Review', percentage: 30, stagePercentage: 7,
      actions: [{ text: 'Review draft', done: true, doneAt }],
    },
    {
      stepKey: 'OLD1', title: 'Legacy step removed from template', stageKey: 'S9', order: 9, status: 'Completed', percentage: 5,
      actions: [{ text: 'Legacy item', done: true }],
    },
  ];

  const merged: any[] = buildUpdatedInstanceSteps(existing as any, template as any, new Date('2026-01-01T00:00:00Z'));
  const t1 = merged.find((step) => step.stepKey === 'T1');
  const t2 = merged.find((step) => step.stepKey === 'T2');
  const t3 = merged.find((step) => step.stepKey === 'T3');
  const old1 = merged.find((step) => step.stepKey === 'OLD1');
  const t1CheckFacts = (t1?.actions || []).filter((action: any) => action.text === 'Check facts');

  check('merge: template steps and case-only steps are all kept', merged.length === 4 && Boolean(t1 && t2 && t3 && old1));
  check(
    'merge: repeated checklist text keeps one tick per occurrence',
    t1CheckFacts.length === 2 && t1CheckFacts[0]?.done === true && t1CheckFacts[1]?.done === false
  );
  check('merge: new template Key Action is added as not done', Boolean(t1?.actions.some((a: any) => a.text === 'Draft memo' && a.done === false)));
  check('merge: case-only Key Action keeps its tick', Boolean(t1?.actions.some((a: any) => a.text === 'Case-specific extra' && a.done === true)));
  check('merge: step progress status preserved', t1?.status === 'In Progress' && t3?.status === 'Awaiting Review');
  check('merge: template step percentage applied when defined', t1?.percentage === 25);
  check('merge: template stage percentage applied when defined', t1?.stagePercentage === 10);
  check('merge: case step percentage preserved when template has none', t3?.percentage === 30);
  check('merge: case stage percentage preserved when template has none', t3?.stagePercentage === 7);
  check('merge: step removed from template keeps progress and ticks', old1?.status === 'Completed' && old1?.actions?.[0]?.done === true);
  check('merge: new step starts from the template default status', t2?.status === 'Not Started');

  check('completed: instance status Completed', isWorkflowInstanceCompleted({ status: 'Completed' }) === true);
  check(
    'completed: all steps done counts as completed even with a stale status',
    isWorkflowInstanceCompleted({ status: 'Active', steps: [{ status: 'Completed' }, { status: 'Completed' }] }) === true
  );
  check(
    'completed: an unfinished step keeps the workflow active',
    isWorkflowInstanceCompleted({ status: 'Active', steps: [{ status: 'Completed' }, { status: 'In Progress' }] }) === false
  );
  check('completed: an empty step list is not completed', isWorkflowInstanceCompleted({ status: 'Active', steps: [] }) === false);

  check(
    'percent: weighted by step percentages',
    computeCompletedPercentFromInstance([{ percentage: 25, status: 'Completed' }, { percentage: 75, status: 'Not Started' }]) === 25
  );
  check(
    'percent: legacy instances fall back to completed/total',
    computeCompletedPercentFromInstance([{ status: 'Completed' }, { status: 'Not Started' }]) === 50
  );
};

const verifyControllerGuards = async () => {
  const admin = { role: 'managing_partner', name: 'Verifier', id: '000000000000000000000000' };
  const template: any = await WorkflowTemplate.findOne({}).lean();

  {
    const { res, captured } = mockRes();
    await updateTemplate(
      { params: { templateId: String(template?._id || '') }, body: { name: template?.name }, user: admin } as any,
      res
    );
    check('stale template save without a revision is rejected (409)', captured.status === 409, captured);
  }
  {
    const { res, captured } = mockRes();
    await updateTemplate(
      {
        params: { templateId: String(template?._id || '') },
        body: { name: template?.name, expectedUpdatedAt: '1970-01-01T00:00:00.000Z' },
        user: admin,
      } as any,
      res
    );
    check(
      'template save from an outdated tab is rejected (409 with refresh message)',
      captured.status === 409 && String(captured.body?.message || '').includes('Refresh'),
      captured
    );
  }

  const closedCase: any = await Case.findOne({ status: 'Closed' }).lean();
  check('a closed matter is available for the guard checks', Boolean(closedCase));
  if (closedCase) {
    {
      const { res, captured } = mockRes();
      await updateCase(
        { params: { id: String(closedCase._id) }, body: { status: 'In Progress' }, user: admin } as any,
        res
      );
      check(
        'a generic case edit cannot reopen a closed matter (400)',
        captured.status === 400 && String(captured.body?.message || '').includes('reopened'),
        captured
      );
    }

    const inst: any = await WorkflowInstance.findOne({ caseId: closedCase._id }).lean();
    if (inst) {
      const { res, captured } = mockRes();
      await toggleStepAction(
        {
          params: { caseId: String(closedCase._id), stepKey: String(inst.steps?.[0]?.stepKey || 'ANY'), index: '0' },
          user: admin,
        } as any,
        res
      );
      check(
        'ticking a key action on a closed matter is rejected (400)',
        captured.status === 400 && String(captured.body?.message || '').includes('Reopen'),
        captured
      );
    } else {
      check('a closed matter with a workflow instance is available', false);
    }
  }

  {
    const { res, captured } = mockRes();
    await fixCaseWorkflowMismatches({ user: admin } as any, res);
    check(
      'admin audit/fix endpoint is wired and reports',
      captured.status === 200 && captured.body && typeof captured.body.repairedCount === 'number',
      captured
    );
    console.log(
      `        (audit endpoint: auto-repaired ${captured.body?.repairedCount ?? '?'}, review-only ${captured.body?.skippedCount ?? '?'})`
    );
    check('no auto-fixable mismatch remains in the database', captured.body?.repairedCount === 0);
  }
};

const verifyDatabaseInvariants = async () => {
  const cases: any[] = await Case.find({}).lean();
  const caseIds = cases.map((caseDoc: any) => caseDoc._id);
  const instances: any[] = caseIds.length
    ? await WorkflowInstance.find({ caseId: { $in: caseIds } }).lean()
    : [];
  const instanceByCaseId = new Map<string, any>(instances.map((inst: any) => [String(inst.caseId), inst]));

  const bounced = cases.filter((caseDoc: any) => {
    const inst = instanceByCaseId.get(String(caseDoc._id));
    if (!inst) return false;
    const completed = isWorkflowInstanceCompleted(inst);
    const markedComplete =
      String(caseDoc.status || '').trim().toLowerCase() === 'closed' ||
      String(caseDoc.workflowProgress?.status || '').trim() === 'Completed';
    return completed && !markedComplete;
  });
  check(
    'no completed workflow sits on a non-closed matter (bounced matters = 0)',
    bounced.length === 0,
    bounced.slice(0, 5).map((c: any) => ({ caseNo: c.caseNo, status: c.status, workflow: c.workflowProgress?.status }))
  );

  const inconsistent = cases.filter(
    (caseDoc: any) =>
      String(caseDoc.workflowProgress?.status || '').trim() === 'Completed' &&
      String(caseDoc.status || '').trim().toLowerCase() !== 'closed'
  );
  check(
    'every workflow-completed matter is Closed',
    inconsistent.length === 0,
    inconsistent.slice(0, 5).map((c: any) => c.caseNo)
  );

  const templateById = await loadWorkflowTemplatesById();
  const gaps = scanWorkflowDataGaps(cases, instanceByCaseId, templateById);
  const restorable = gaps.filter((gap: any) => !gap.terminal);
  const totals = restorable.reduce(
    (acc: { actions: number; step: number; stage: number; titles: number }, gap: any) => ({
      actions: acc.actions + gap.actionsToAdd,
      step: acc.step + gap.stepPercentagesToFill,
      stage: acc.stage + gap.stagePercentagesToFill,
      titles: acc.titles + gap.stageTitlesToFill,
    }),
    { actions: 0, step: 0, stage: 0, titles: 0 }
  );
  check(
    'no restorable Key Actions / percentages remain',
    totals.actions + totals.step + totals.stage + totals.titles === 0,
    { totals, sample: restorable.slice(0, 3).map((gap: any) => ({ caseNo: gap.caseNo, actionsToAdd: gap.actionsToAdd })) }
  );

  const reviewGaps = gaps.filter(
    (gap: any) => gap.templateMissing || gap.templateOnlySteps > 0 || gap.zeroPercentagesForReview > 0
  );
  console.log(
    `        (${gaps.length} matters differ from their template; ${reviewGaps.length} are review-only items such as deleted templates)`
  );
};

const verifyDashboard = async () => {
  const { res, captured } = mockRes();
  await getExecutiveAssistantDashboard(
    { user: { role: 'executive_assistant', name: 'Verifier' }, query: {} } as any,
    res
  );
  check(
    'executive dashboard loads with pending follow-ups',
    captured.status === 200 && Array.isArray(captured.body?.pendingFollowUp),
    captured.status === 200 ? undefined : captured
  );

  const candidates: any[] = await Task.find({ status: { $ne: 'Completed' } })
    .sort({ dueDate: 1, priority: 1 })
    .limit(100)
    .lean();
  const caseIds = Array.from(new Set(candidates.map((task: any) => String(task.caseId)).filter(Boolean)));
  const cases: any[] = await Case.find({ _id: { $in: caseIds } })
    .select('_id caseNo parties status workflowProgress')
    .lean();
  const caseMap = new Map<string, any>(cases.map((caseDoc: any) => [String(caseDoc._id), caseDoc]));

  const isLiveTask = (task: any) => {
    const caseDoc: any = caseMap.get(String(task.caseId));
    return (
      !caseDoc ||
      (String(caseDoc.status || '').trim().toLowerCase() !== 'closed' &&
        String(caseDoc.workflowProgress?.status || '').trim() !== 'Completed')
    );
  };
  const excluded = candidates.filter((task: any) => !isLiveTask(task));
  const expectedTitles = candidates
    .filter(isLiveTask)
    .slice(0, 10)
    .map((task: any) => {
      const caseDoc: any = caseMap.get(String(task.caseId));
      const label = caseDoc ? caseDoc.caseNo || caseDoc.parties || '' : '';
      return label ? `${task.title} — ${label}` : task.title;
    });
  const actualTitles = (captured.body?.pendingFollowUp || []).map((item: any) => item.title);
  check(
    'closed-matter tasks are excluded from the pending follow-up list',
    JSON.stringify(actualTitles) === JSON.stringify(expectedTitles)
  );
  console.log(`        (${excluded.length} open task(s) on closed/completed matters are being excluded)`);
};

const run = async () => {
  await connectDB();

  console.log('\nA. Workflow merge + completion logic (no database writes)');
  verifyMergeLogic();

  console.log('\nB. API guards - stale saves and closed matters (rejection paths only)');
  await verifyControllerGuards();

  console.log('\nC. Live database invariants');
  await verifyDatabaseInvariants();

  console.log('\nD. Executive dashboard pending follow-ups');
  await verifyDashboard();

  console.log('');
  console.log(`Result: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

run().catch((err) => {
  console.error('Verification failed to run:', err);
  process.exit(1);
});
