// Production-bundle UI checks. All API requests are intercepted; no real account or database is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { chromium } = require('playwright');
const origin = 'http://127.0.0.1:5178';
const actor = { id: 'ui-user', name: 'Performance User', email: 'performance@ui.invalid', role: 'associate' };
const earnedFees = { currency: 'RWF', team: [], keyActions: [], stages: [], totals: {} };
const template = { _id: 'ui-template', name: 'Performance', matterType: 'Performance', caseType: 'Transactional Cases',
  stages: [{ key: 'work', title: 'Work', order: 1, percentage: 100 }], steps: [] };
const matter = { _id: 'ui-case', caseNo: 'UI-PERF-1', parties: 'Performance fixture', caseType: 'Transactional Cases',
  status: 'In Progress', assignedTo: actor.name, caseAssignments: { initiator: actor.name, reviewer: 'Reviewer', signerApprover: 'Approver' },
  workflowTemplateId: template._id, matterType: template.matterType, workflow: template.matterType,
  workflowProgress: { status: 'Active', percent: 0 }, billingSettings: { currency: 'RWF' }, clientContacts: [] };

async function main() {
  const options = { headless: true };
  if (!fs.existsSync(chromium.executablePath())) options.channel = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : 'msedge';
  const browser = await chromium.launch(options);
  const results = [];
  const errors = [];
  try {
    const login = await browser.newPage();
    login.on('pageerror', error => errors.push(error.message));
    const scripts = new Set();
    login.on('request', request => { if (request.resourceType() === 'script') scripts.add(new URL(request.url()).pathname); });
    await login.route('**/auth/login', async route => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      await route.fulfill({ status: 401, json: { message: 'Synthetic login refusal' } });
    });
    await login.goto(`${origin}/login`);
    await login.getByRole('button', { name: 'Sign In', exact: true }).waitFor();
    assert(![...scripts].some(file => /exceljs|jspdf|CaseWorkspace|ManagingPartnerDashboard/.test(file)), 'Login must not download workspaces, chart dashboards, or export libraries');
    const sizes = [...scripts].map(file => fs.readFileSync(path.resolve(__dirname, '../../build', file.slice(1))));
    console.log('LOGIN_BUNDLE', JSON.stringify({ requests: scripts.size, bytes: sizes.reduce((n, data) => n + data.length, 0), gzipBytes: sizes.reduce((n, data) => n + gzipSync(data).length, 0) }));
    await login.getByLabel('Email Address').fill(actor.email);
    await login.getByLabel('Password', { exact: true }).fill('test-only');
    const start = Date.now();
    await login.getByRole('button', { name: 'Sign In', exact: true }).click();
    await login.getByRole('button', { name: 'Signing In...' }).waitFor({ timeout: 800 });
    results.push({ action: 'login feedback', ms: Date.now() - start });
    await login.getByText('Synthetic login refusal').waitFor();
    await login.close();

    for (const action of ['review', 'approval', 'approve', 'tick', 'reopen']) {
      for (const fail of [false, true]) {
        const page = await browser.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(user => { localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('token', 'ui-only'); }, actor);
        const initialStatus = { review: 'Done', approval: 'Awaiting Review', approve: 'Awaiting Approval', tick: 'In Progress', reopen: 'Done' }[action];
        const nextStatus = { review: 'Awaiting Review', approval: 'Awaiting Approval', approve: 'Completed', tick: 'Done', reopen: 'In Progress' }[action];
        const checklist = action === 'tick' || action === 'reopen';
        const step = { stepKey: 'action', title: 'Test key action', stageKey: 'work', stageTitle: 'Work', order: 1, percentage: 100, stagePercentage: 100,
          status: initialStatus, startAt: '2026-11-01T08:00:00Z', dueAt: '2026-12-01T08:00:00Z', actions: [], outputs: [] };
        const workflow = { _id: 'ui-workflow', caseId: matter._id, templateId: template._id, status: 'Active', currentStepKey: step.stepKey, steps: [step] };
        const management = () => ({ caseId: matter._id, caseNo: matter.caseNo, parties: matter.parties, workflowStatus: 'Active', myRole: 'admin',
          canEnterQualityScore: false, members: [], qualityScore: null, steps: [step], earnedFees });
        let workflowReads = 0;
        let writes = 0;
        await page.route('**/*', async route => {
          const request = route.request();
          if (!['fetch', 'xhr'].includes(request.resourceType())) return route.continue();
          const key = new URL(request.url()).pathname;
          if (request.method() !== 'GET') {
            writes++;
            await new Promise(resolve => setTimeout(resolve, 1200));
            if (fail) return route.fulfill({ status: 403, json: { message: 'Synthetic save refusal' } });
            step.status = nextStatus;
            return route.fulfill({ json: checklist ? workflow : management() });
          }
          let body = [];
          if (key.endsWith('/case-management/cases/ui-case')) body = management();
          else if (key.endsWith('/workflows/cases/ui-case')) { workflowReads++; await new Promise(resolve => setTimeout(resolve, 80)); body = workflow; }
          else if (key.endsWith('/workflows/templates/ui-template')) body = template;
          else if (key.endsWith('/cases/ui-case')) body = matter;
          else if (key.endsWith('/earned-fees')) body = earnedFees;
          else if (key.includes('unread')) body = { count: 0 };
          await route.fulfill({ json: body });
        });
        await page.goto(`${origin}/cases/ui-case${checklist ? '' : '?tab=case-management'}`);
        const name = { review: 'Send to Reviewer', approval: 'Send to Signer / Approver', approve: 'Approve & Complete', tick: 'Click to mark Key Action as done', reopen: 'Click to reopen Key Action' }[action];
        const button = checklist ? page.getByTitle(name, { exact: true }) : page.getByRole('button', { name, exact: true });
        await button.waitFor();
        const before = Date.now();
        await button.click();
        if (checklist) await page.getByTitle(action === 'tick' ? 'Click to reopen Key Action' : 'Click to mark Key Action as done', { exact: true }).waitFor({ timeout: 800 });
        else await page.getByRole('status').filter({ hasText: 'Saving changes' }).waitFor({ timeout: 800 });
        results.push({ action: `${action} ${fail ? 'rollback' : 'success'} feedback`, ms: Date.now() - before });
        assert.equal(writes, 1, 'One click must issue one mutation');
        if (fail) {
          await page.getByText('Synthetic save refusal', { exact: true }).waitFor();
          assert(await (checklist ? page.getByTitle(name, { exact: true }) : page.getByRole('button', { name, exact: true })).isEnabled(), 'A failed transition must restore its original action');
        } else {
          await page.waitForTimeout(1400);
          if (checklist) assert.equal(workflowReads, 1, 'Initial reads are shared and saved workflow is reused without a second GET');
          else assert.equal(await page.getByText('Saving changes…', { exact: true }).count(), 0);
        }
        await page.close();
      }
    }
    const exportsPage = await browser.newPage();
    exportsPage.on('pageerror', error => errors.push(error.message));
    await exportsPage.addInitScript(user => { localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('token', 'ui-only'); }, actor);
    await exportsPage.route('**/*', async route => {
      if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
      const key = new URL(route.request().url()).pathname;
      await route.fulfill({ json: key.endsWith('/cases') ? [matter] : key.includes('unread') ? { count: 0 } : [] });
    });
    await exportsPage.goto(`${origin}/cases`);
    for (const [title, signature] of [['Download report as Excel (.xlsx)', 'PK'], ['Download report as PDF', '%PDF']]) {
      const downloaded = exportsPage.waitForEvent('download');
      await exportsPage.getByTitle(title, { exact: true }).click();
      const stream = await (await downloaded).createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).subarray(0, signature.length).toString(), signature, 'Lazy export must still generate a valid file');
    }
    await exportsPage.close();
    assert.deepEqual(errors, [], 'No browser runtime errors');
    assert(results.every(result => result.ms < 1000), 'All visual responses must take less than one second even when the API waits 1.2 seconds');
    console.table(results);
    console.log('PASS: login payload isolation, immediate action feedback, failed-save rollback, duplicate-read removal, valid lazy Excel/PDF downloads, and browser runtime checks.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
