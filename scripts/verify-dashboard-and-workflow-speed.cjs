/** Local production-bundle tests with streamed data and deliberately slow saves. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const express = require('../colin-backend/node_modules/express');
const { chromium } = require('../colin-backend/node_modules/playwright');
const roles = ['managing_director', 'managing_partner', 'executive_managing_partner', 'senior_partner', 'partner', 'executive_partner', 'associate_partner', 'executive_associate_partner', 'senior_associate', 'senior_executive_assistant', 'associate', 'trainee_associate', 'executive_assistant', 'originating_attorney', 'intern'];
const user = role => ({ id: 'ui-user', name: 'Fixture User', email: `${role}@speed.invalid`, role });
const step = (n, status = 'Not Started') => ({ stepKey: `action_${n}`, title: `Key action ${n}`, stageKey: 'work', stageTitle: 'Work', stageOrder: 1, order: n,
  percentage: 30, stagePercentage: 100, status, startAt: '2026-11-01T08:00:00Z', dueAt: '2026-12-01T08:00:00Z', actions: [], outputs: [] });
const template = { _id: 'ui-template', name: 'Speed fixture', matterType: 'Speed fixture', caseType: 'Transactional Cases',
  stages: [{ key: 'work', title: 'Work', order: 1, percentage: 100 }], steps: [1, 2, 3].map(n => ({ key: `action_${n}`, title: `Key action ${n}`, stageKey: 'work', order: n, percentage: 30 })) };
const matter = { _id: 'ui-case', caseNo: 'MAT-FAST-1', parties: 'Rapid Client', caseType: 'Transactional Cases', status: 'In Progress', assignedTo: 'Fixture User',
  caseAssignments: { initiator: 'Fixture User', reviewer: 'Reviewer', signerApprover: 'Approver' }, workflowTemplateId: 'ui-template', workflow: template.matterType,
  matterType: template.matterType, budget: '1000000', workflowProgress: { status: 'In Progress', percent: 0 }, billingSettings: { currency: 'RWF' }, clientContacts: [] };
const freshWorkflow = () => ({ _id: 'ui-workflow', caseId: matter._id, templateId: 'ui-template', status: 'Active', currentStepKey: 'action_1', steps: [step(1, 'In Progress'), step(2), step(3)] });
const summary = () => ({ user: { name: 'Fixture User' }, currency: 'RWF', tpaPercent: 5, mattersAssigned: 1, mattersOutstanding: 1, mattersCompleted: 0, overdueSections: 0,
  averageTimelinessScore: 90, averageQualityScore: 90, feesEarnedTotal: 123450, collectedBaseTotal: 500000, rows: [],
  workByMatter: { 'ui-case': { caseId: 'ui-case', caseNo: matter.caseNo, parties: matter.parties, steps: [{ stepKey: 'work', title: 'Immediate dashboard work', status: 'Not Started', dueAt: '2026-12-01T08:00:00Z' }] } },
  period: { key: 'all', label: 'All Time', isAllTime: true, feesEarned: 123450, collectedValue: 500000, keyActionsChecked: 1, sectionsCompleted: 0, tasksCompleted: 0,
    tasksOutstanding: 1, mattersCompleted: 0, mattersWithActivity: 1, mattersCreatedInPeriod: 1, averageTimelinessScore: 90, averageQualityScore: 90, contractValue: 1000000 } });

async function main() {
  let workflow = freshWorkflow(), fail = false, writes = [], workflowReads = 0;
  const requests = [], errors = [], timings = [], auxiliarySent = new Map();
  const app = express(); app.use(express.json());
  app.use('/api', (req, _res, next) => { requests.push({ role: req.headers.authorization?.split(':')[1], path: req.path }); next(); });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/api/auth/login', (req, res) => { const role = req.body.email.split('@')[0]; setTimeout(() => res.json({ token: `fixture:${role}`, user: user(role) }), 30); });
  app.get('/api/dashboard/bootstrap', (req, res) => {
    const role = req.headers.authorization.split(':')[1]; auxiliarySent.set(role, false);
    res.setHeader('content-type', 'application/x-ndjson'); res.flushHeaders();
    const send = (section, value) => { if (!res.destroyed) res.write(JSON.stringify({ section, status: 'fulfilled', value }) + '\n'); };
    const management = ['managing_director', 'managing_partner', 'executive_managing_partner'].includes(role);
    setTimeout(() => {
      if (role === 'executive_assistant') {
        send('executive', { stats: { casesCreatedMTD: 17, documentsUploadedMTD: 3, scheduledEventsMTD: 4, tasksCoordinatedMTD: 5 }, today: { label: 'Today' }, todaySchedule: [], pendingFollowUp: [], recentCases: [] });
        return res.end();
      }
      send('cases', [matter]); send('tasks', []);
      if (management) {
        send('billing', { billed: 10000, collected: 5000, outstanding: 5000, collectionRate: 50, months: [] });
        send('invoices', []); send('fund', null); send('staff', []); send('audit', []); send('prospects', []);
      } else {
        send('summary', summary()); send('performance', {}); send('prospects', []); send('independent', { items: [] }); send('audit', { items: [], total: 0, pages: 1, page: 1 });
      }
    }, 80);
    // This source deliberately remains pending while core dashboard data renders.
    setTimeout(() => { auxiliarySent.set(role, true); send('events', []); if (!res.destroyed) res.end(); }, 2500);
  });
  app.get('/api/cases/ui-case', (_req, res) => res.json(matter));
  app.get('/api/workflows/cases/ui-case', (_req, res) => { workflowReads++; setTimeout(() => res.json(workflow), 80); });
  app.get('/api/workflows/templates/ui-template', (_req, res) => res.json(template));
  app.get('/api/workflows/cases/ui-case/earned-fees', (_req, res) => res.json({ currency: 'RWF', team: [], keyActions: [], stages: [], totals: {} }));
  app.use('/api/workflows/cases/ui-case/steps', async (req, res) => {
    const target = req.path.split('/')[1]; writes.push({ path: req.path, method: req.method });
    await new Promise(done => setTimeout(done, 1200));
    if (fail) return res.status(403).json({ message: 'Synthetic save refusal' });
    if (req.method === 'POST' && req.path === '/') workflow.steps.push({ ...step(4), stepKey: 'custom-fast', custom: true, title: req.body.title, percentage: req.body.percentage });
    else if (req.method === 'DELETE') workflow.steps = workflow.steps.filter(item => item.stepKey !== target);
    else if (req.path.endsWith('/complete')) { const item = workflow.steps.find(item => item.stepKey === target); item.status = 'Done'; item.doneAt = new Date().toISOString(); }
    else if (req.path.endsWith('/extend-deadline')) {
      const item = workflow.steps.find(item => item.stepKey === target); item.dueAt = req.body.newDueAt;
      item.extensionHistory = [{ previousDueAt: '2026-12-01T08:00:00Z', newDueAt: req.body.newDueAt, days: 1, grantedBy: 'Fixture User', grantedAt: new Date().toISOString(), mode: req.body.mode }];
    }
    res.json(workflow);
  });
  app.use('/api', (req, res) => res.json(req.path.includes('unread') ? { count: 0 } : []));
  app.use(express.static(path.resolve(__dirname, '../build')));
  app.use((_req, res) => res.sendFile(path.resolve(__dirname, '../build/index.html')));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const redirectFetch = () => {
    const native = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(String(input), location.origin);
      return native(url.pathname.startsWith('/api/') ? `${location.origin}${url.pathname}${url.search}` : input, init);
    };
  };
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    for (const role of roles) {
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(redirectFetch);
      await page.addInitScript(() => { localStorage.removeItem('user'); localStorage.removeItem('token'); });
      await page.goto(`${origin}/login`);
      await page.getByLabel('Email Address').fill(`${role}@speed.invalid`);
      await page.getByLabel('Password', { exact: true }).fill('test-only');
      const started = Date.now();
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      if (role === 'executive_assistant') await page.getByText('17', { exact: true }).first().waitFor();
      else if (['managing_director', 'managing_partner', 'executive_managing_partner'].includes(role)) await page.locator('.mp-metrics-grid').getByText('Active Matters', { exact: true }).waitFor();
      else await page.getByText('Immediate dashboard work', { exact: true }).first().waitFor();
      timings.push({ action: `dashboard data ${role}`, ms: Date.now() - started });
      if (role !== 'executive_assistant') assert.equal(auxiliarySent.get(role), false, 'A slow auxiliary section must not block primary dashboard data');
      assert.equal(requests.filter(item => item.role === role && item.path === '/dashboard/bootstrap').length, 1, 'Sign-in and dashboard share one data stream');
      assert(!requests.some(item => item.role === role && item.path.includes('/case-management/cases/')), 'Dashboard work must not fan out into per-matter requests');
      await page.close();
    }
    console.log('PASS: sign-in and real visible dashboard data for every role; one stream; slow sources do not block core data; no per-matter request fan-out');

    async function openWorkflow() {
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(redirectFetch);
      await page.addInitScript(actor => { localStorage.setItem('user', JSON.stringify(actor)); localStorage.setItem('token', 'fixture:associate'); }, user('associate'));
      await page.goto(`${origin}/cases/ui-case`);
      await page.getByTitle('Click to mark Key Action as done', { exact: true }).first().waitFor();
      return page;
    }
    const page = await openWorkflow();
    const tick = page.getByTitle('Click to mark Key Action as done', { exact: true }).first();
    let started = Date.now(); await tick.click();
    await page.getByTitle('Click to reopen Key Action', { exact: true }).first().waitFor({ timeout: 800 });
    timings.push({ action: 'first tick feedback', ms: Date.now() - started });
    const nextTick = page.getByTitle('Click to mark Key Action as done', { exact: true }).first();
    assert(await nextTick.isEnabled(), 'Next Key Action unlocks before the first network save finishes');
    started = Date.now(); await nextTick.click();
    await page.waitForFunction(() => document.querySelectorAll('[title="Click to reopen Key Action"]').length === 2, undefined, { timeout: 800 });
    timings.push({ action: 'next tick feedback', ms: Date.now() - started });
    assert.equal(writes.length, 1, 'Dependent saves must be sent sequentially');
    await page.getByRole('status').filter({ hasText: 'Saving' }).waitFor({ state: 'hidden' });
    assert.deepEqual(writes.map(item => item.path), ['/action_1/complete', '/action_2/complete']);
    assert.equal(workflowReads, 1, 'Ticking does not reload the workflow');

    await page.getByRole('button', { name: 'Add Key Action', exact: true }).click();
    await page.getByPlaceholder('Describe the Key Action to add to this stage').fill('Fast added action');
    await page.getByPlaceholder('e.g. 10', { exact: true }).fill('10');
    started = Date.now(); await page.getByRole('button', { name: 'Add Key Action', exact: true }).last().click();
    await page.getByText('Fast added action', { exact: true }).waitFor({ timeout: 800 });
    timings.push({ action: 'add feedback', ms: Date.now() - started });
    await page.getByRole('status').filter({ hasText: 'Saving' }).waitFor({ state: 'hidden' });
    await page.getByTitle(/^Delete this Key Action from this matter/).last().click();
    started = Date.now(); await page.getByRole('button', { name: 'Delete Key Action', exact: true }).filter({ hasText: 'Delete Key Action' }).last().click();
    await page.getByText('Fast added action', { exact: true }).waitFor({ state: 'hidden', timeout: 800 });
    timings.push({ action: 'delete feedback', ms: Date.now() - started });
    await page.getByRole('status').filter({ hasText: 'Saving' }).waitFor({ state: 'hidden' });

    await page.getByTitle('Amend deadline', { exact: true }).last().click();
    await page.locator('input[type=datetime-local]').fill('2030-01-01T12:00');
    started = Date.now(); await page.getByRole('button', { name: 'Amend deadline', exact: true }).click();
    await page.getByText(/2030/).first().waitFor({ timeout: 800 });
    timings.push({ action: 'deadline feedback', ms: Date.now() - started });
    await page.getByRole('status').filter({ hasText: 'Saving' }).waitFor({ state: 'hidden' });
    assert.equal(workflowReads, 1, 'Adding, deleting and amending reuse the saved workflow');
    fail = true;
    await page.getByRole('button', { name: 'Add Key Action', exact: true }).click();
    await page.getByPlaceholder('Describe the Key Action to add to this stage').fill('Rejected new action');
    await page.getByPlaceholder('e.g. 10', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Add Key Action', exact: true }).last().click();
    await page.getByText('Rejected new action', { exact: true }).waitFor({ timeout: 800 });
    await page.getByRole('alert').filter({ hasText: 'Synthetic save refusal' }).waitFor();
    assert.equal(await page.getByText('Rejected new action', { exact: true }).count(), 0, 'Rejected additions restore the saved checklist');
    assert.equal(await page.getByPlaceholder('Describe the Key Action to add to this stage').inputValue(), 'Rejected new action', 'Rejected additions retain the entered form values');
    await page.close();

    workflow = freshWorkflow(); fail = true; writes = [];
    const rollback = await openWorkflow();
    await rollback.getByTitle('Click to mark Key Action as done', { exact: true }).first().click();
    await rollback.getByTitle('Click to mark Key Action as done', { exact: true }).first().click();
    await rollback.getByRole('alert').filter({ hasText: 'Synthetic save refusal' }).waitFor();
    assert.equal(writes.length, 1, 'Failure cancels the queued dependent tick');
    assert.equal(await rollback.getByTitle('Click to reopen Key Action', { exact: true }).count(), 0);
    assert(await rollback.getByTitle('Click to mark Key Action as done', { exact: true }).first().isEnabled());
    assert(await rollback.getByTitle(/^Complete ".*" first$/).count() > 0);
    await rollback.close();
    assert.deepEqual(errors, [], 'No dashboard or workflow runtime errors');
    assert(timings.filter(item => !item.action.startsWith('dashboard')).every(item => item.ms < 1000), 'Workflow feedback must remain under a second even when actual saves are deliberately delayed');
    console.table(timings);
    console.log('PASS: immediate ticks/next-action unlock, ordered durable saves, add/delete/amend feedback, no workflow reload, failure rollback and dependent cancellation');
  } finally {
    if (browser) await browser.close();
    await new Promise(done => server.close(done));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
