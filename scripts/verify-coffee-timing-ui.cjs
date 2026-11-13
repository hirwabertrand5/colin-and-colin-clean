/** Production UI with a scoped local snapshot and intercepted API; never writes live records. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('../colin-backend/node_modules/express');
const { EJSON } = require('../colin-backend/node_modules/bson');
const { chromium } = require('../colin-backend/node_modules/playwright');
const { buildTimingPlan } = require('../colin-backend/scripts/repairCoffeeTiming.cjs');
const { computeStepWorkTimelinessScore } = require('../colin-backend/dist/utils/caseEarnedFees');
const { buildPlan: buildApprovedPlan } = require('../colin-backend/scripts/completeCoffeeCarryover.cjs');
const approvedMode = process.argv.includes('--approved');
const folder = path.resolve(__dirname, '../colin-backend/.local-operations');
const file = fs.readdirSync(folder).filter(name => name.startsWith(approvedMode ? 'coffee-full-comparison-' : 'coffee-sequence-inspection-')).sort().at(-1);
const source = EJSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
const actor = { id: '111111111111111111111111', name: 'Managing Partner', email: 'timing@fixture.invalid', role: 'managing_director' };
const users = [{ name: 'Chance', role: 'trainee_associate' }, { name: 'Xavier', role: 'senior_associate' }, actor];
const plan = approvedMode ? buildApprovedPlan(source) : buildTimingPlan(source, users);
const workflow = JSON.parse(JSON.stringify(plan.next));
// Include an actually late submission, a missing event and a later approval to
// prove the production components do not colour every tick green blindly.
if (!approvedMode) workflow.steps[25] = { ...workflow.steps[25], status: 'Completed', dueAt: '2026-11-10T12:00:00Z',
  doneAt: '2026-11-10T11:00:00Z', submittedAt: '2026-11-10T13:00:00Z', completedAt: '2026-11-15T12:00:00Z' };
if (!approvedMode) workflow.steps[26] = { ...workflow.steps[26], status: 'Done', doneAt: undefined };
const earned = { contractValue: 300000, currency: 'RWF', completedPercent: approvedMode ? 81.5 : 55.5, completedValue: approvedMode ? 244500 : 166500,
  collectedAmount: 300000, eligibleCollectedValue: 166500, earnedValue: 166500, completedKeyActions: 15,
  keyActions: [], missingKeyActionPercentages: [], stages: [], team: [], staffEarnedTotal: 0, firmFee: 166500,
  qualityScore: 95, qualityScoredBy: 'Xavier' };
const management = { caseId: String(source.matter._id), caseNo: source.matter.caseNo, parties: source.matter.parties,
  workflowStatus: 'Active', currentStepKey: 'key_action_1', myRole: 'admin', canEnterQualityScore: false,
  qualityScore: 95, qualityScoredBy: 'Xavier', qualityScoredAt: source.matter.caseManagement?.qualityScoredAt,
  members: ['Chance', 'Xavier', 'Managing Partner'].map((name, i) => ({ key: ['initiator','reviewer','approver'][i], role: ['Initiator','Reviewer','Signer/Approver'][i], name, userRole: users[i].role, tpaPercent: [3,6,10][i] })),
  steps: workflow.steps.map(step => ({ ...step, timelinessScore: computeStepWorkTimelinessScore(step) })), earnedFees: earned };

async function main() {
  const root = path.resolve(__dirname, '..');
  const app = express(); app.use(express.static(path.join(root, 'build')));
  app.use((_req, res) => res.sendFile(path.join(root, 'build/index.html')));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, timezoneId: 'Africa/Kigali' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(actor => { localStorage.setItem('token', 'isolated-fixture'); localStorage.setItem('user', JSON.stringify(actor)); }, actor);
    await page.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname;
      let body = {};
      if (endpoint.endsWith(`/case-management/cases/${source.matter._id}`)) body = management;
      else if (endpoint.endsWith(`/cases/${source.matter._id}`)) body = endpoint.includes('/workflows/') ? workflow : source.matter;
      else if (endpoint.includes('/workflows/templates/')) body = source.template;
      else if (endpoint.endsWith('/earned-fees')) body = earned;
      else if (endpoint.includes('/documents') || endpoint.includes('/tasks') || endpoint.includes('/users') || endpoint.endsWith('/cases')) body = [];
      else if (endpoint.includes('/notifications/count')) body = { unread: 0 };
      else if (endpoint.includes('/audit')) body = { logs: [], items: [], total: 0, page: 1, pages: 1 };
      await route.fulfill({ status: 200, json: body });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/cases/${source.matter._id}`);
    await page.getByText('Workflow Checklist', { exact: true }).waitFor();
    if (approvedMode) {
      const risk = page.getByText('Done · At risk · 14%', { exact: true });
      await risk.first().waitFor(); assert.equal(await risk.count(), 11);
      for (const pill of await risk.all()) assert(await pill.evaluate(el => el.classList.contains('deadline-urgency-red')));
      const good = page.getByText('Done · Good · 58%', { exact: true });
      assert.equal(await good.count(), 3);
      for (const pill of await good.all()) assert(await pill.evaluate(el => el.classList.contains('deadline-urgency-green')));
      assert.equal(await page.getByText('Done · Excellent · 94%', { exact: true }).count(), 5);
      assert.equal(await page.getByText('Done · Excellent · 100%', { exact: true }).count(), 6);
      assert.equal(await page.getByText('Completed (approved)', { exact: true }).count(), 25);
      assert.equal(await page.getByRole('region', { name: 'Work timing and approvals' }).count(), 0);
      await page.locator('h3').filter({ hasText: workflow.steps[25].title }).waitFor();
      await page.getByRole('button', { name: 'Case Management', exact: true }).click();
      await page.getByText('Original workflow submission:', { exact: true }).first().waitFor();
      assert.equal(await page.getByText('Completed (approved)', { exact: true }).count(), 25);
      assert.equal(await page.getByRole('button', { name: /Send to Reviewer|Send to Signer|Approve & Complete/ }).count(), 0, 'All migrated work is already approved: no hand-off buttons anywhere');
      assert.equal(await page.getByText('Approved:', { exact: true }).count(), 25);
      const percentages = page.getByText('14%', { exact: true });
      assert.equal(await percentages.count(), 11);
      for (const score of await percentages.all()) assert(await score.evaluate(el => el.classList.contains('deadline-urgency-red')), 'The 14% score and deadline result must both be red');
      for (const pill of await page.getByText('Done · At risk · 14%', { exact: true }).all()) assert(await pill.evaluate(el => el.classList.contains('deadline-urgency-red')));
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      const red = await page.getByText('Done · At risk · 14%', { exact: true }).first().evaluate(el => getComputedStyle(el).backgroundColor);
      const green = await page.getByText('Done · Good · 58%', { exact: true }).first().evaluate(el => getComputedStyle(el).backgroundColor);
      assert.notEqual(red, green);
      assert.deepEqual(errors, []);
      console.log('PASS: this case has 25 approved actions and no hand-off buttons; 14% red, 58% green, 94/100% blue in both tabs, original approval dates, next action 26, no removed summary and dark mode');
      return;
    }
    const onTime = page.getByText('Done on time', { exact: true });
    await onTime.first().waitFor();
    assert.equal(await onTime.count(), 25);
    const summary = page.getByRole('region', { name: 'Work timing and approvals', exact: true });
    assert.equal(await summary.count(), 0, 'The requested summary is removed from Overview');
    assert.equal(await page.getByText('Completed (approved)', { exact: true }).count(), 16);
    const journey = page.locator('h3').filter({ hasText: workflow.steps[27].title });
    await journey.waitFor();
    for (const pill of await onTime.all()) assert(await pill.evaluate(el => el.classList.contains('deadline-urgency-green')), 'On-time completed work must use the green result class');
    const green = await onTime.first().evaluate(el => getComputedStyle(el).backgroundColor);
    const late = page.getByText('Done 1h 0m late', { exact: true }); await late.waitFor();
    assert(await late.evaluate(el => el.classList.contains('deadline-urgency-red')));
    const red = await late.evaluate(el => getComputedStyle(el).backgroundColor);
    assert.notEqual(green, red, 'Actual rendered on-time and late colours must differ');
    await page.getByText('Completion time unavailable', { exact: true }).waitFor();
    assert.equal(await page.getByText(/^Original submission:/).count(), 25, 'Original date must be visible beside every restored result');
    assert((await page.getByText(/^Original submission:/).first().textContent()).includes('10/30/2026'), 'Original client instruction date is shown instead of correction date');
    await page.getByRole('button', { name: 'Case Management', exact: true }).click();
    await page.getByText('Original workflow submission:', { exact: true }).first().waitFor();
    assert.equal(await summary.count(), 0, 'The requested summary is removed from Case Management');
    const approved = page.getByText('Completed (approved)', { exact: true });
    assert.equal(await approved.count(), 16);
    for (const chip of await approved.all()) {
      const card = chip.locator('xpath=../../..');
      assert.equal(await card.getByRole('button', { name: /Send to Reviewer|Send to Signer|Approve & Complete/ }).count(), 0, 'Completed work cannot show review or approval controls');
    }
    assert.equal(await page.getByText('Done on time', { exact: true }).count(), 25);
    for (const pill of await page.getByText('Done on time', { exact: true }).all()) assert(await pill.evaluate(el => el.classList.contains('deadline-urgency-green')));
    assert.equal(await page.getByText('Original workflow submission:', { exact: true }).count(), 25);
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    assert.notEqual(await page.getByText('Done on time', { exact: true }).first().evaluate(el => getComputedStyle(el).backgroundColor), await page.getByText('Done 1h 0m late', { exact: true }).evaluate(el => getComputedStyle(el).backgroundColor));
    assert.deepEqual(errors, []);
    console.log('PASS: summary removed from both tabs, Completed actions labelled approved without hand-off controls, original timing/colours, next work action and dark mode');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
