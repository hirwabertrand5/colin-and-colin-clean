/** Local browser regression checks with synthetic API data; no client records. */
const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const express = require('../colin-backend/node_modules/express');
const { chromium } = require('../colin-backend/node_modules/playwright');

async function main() {
  const app = express();
  const build = path.resolve(__dirname, '../build');
  app.use(express.static(build));
  app.use((_req, res) => res.sendFile(path.join(build, 'index.html')));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    console.log('Starting local Edge browser verification...');
    browser = await chromium.launch({ executablePath: process.env.CASE_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      localStorage.setItem('token', 'synthetic-verification-token');
      localStorage.setItem('user', JSON.stringify({ id: 'test-partner', name: 'Verification Partner', email: 'partner@test.invalid', role: 'managing_partner' }));
      localStorage.setItem('theme', 'dark');
    });
    const legalServicePath = [
      { id: 'dispute_resolution', label: 'A. Dispute Resolution' },
      { id: 'litigation', label: 'Litigation' },
      { id: 'civil_litigation', label: 'Civil Litigation' },
      // Simulate a saved service whose ID was replaced in the current catalogue.
      { id: 'retired_debt_service', label: 'Debt recovery & enforcement' },
    ];
    const original = { _id: 'matter-test', caseNo: 'CASE-TEST-001', parties: 'Synthetic client', caseType: 'Litigation Cases', status: 'Active', priority: 'Medium',
      assignedTo: 'Verification Initiator', caseAssignments: { initiator: 'Verification Initiator', reviewer: 'Verification Reviewer', signerApprover: 'Verification Partner' },
      legalServicePath, workflow: 'DEBT RECOVERY', matterType: 'DEBT RECOVERY', workflowTemplateId: 'original-template', workflowInstanceId: 'original-instance',
      workflowStartDate: '2026-11-01T00:00:00Z', budget: '600000', description: 'Original summary',
      workflowProgress: { status: 'In Progress', currentStepTitle: 'Deliver the LBA', percent: 0, plannedValue: { amount: 600000, currency: 'RWF' } } };
    let matter = structuredClone(original);
    let rejectSave = false;
    let activeTemplateRequests = 0;
    const payloads = [];
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.includes('/api/')) return url.origin === base ? route.continue() : route.abort();
      const endpoint = url.pathname.split('/api/')[1];
      let data = [];
      let status = 200;
      if (endpoint === 'cases/matter-test') {
        if (request.method() === 'PUT') {
          const payload = request.postDataJSON(); payloads.push(payload);
          if (rejectSave) { data = { message: 'Synthetic save failure' }; status = 400; }
          else { matter = { ...matter, ...payload }; data = matter; }
        } else data = matter;
      } else if (endpoint === 'users/assignment-options') data = [
        { _id: 'i', name: 'Verification Initiator' }, { _id: 'r', name: 'Verification Reviewer' }, { _id: 'p', name: 'Verification Partner' }, { _id: 'n', name: 'New Initiator' },
      ];
      else if (endpoint === 'workflows/templates/active') {
        activeTemplateRequests++;
        data = [{ _id: 'new-template', matterType: 'Civil Litigation', caseType: 'Litigation Cases', stages: [], steps: [], active: true, version: 9 }];
      } else if (endpoint.startsWith('workflows/templates/')) data = { _id: 'original-template', matterType: 'DEBT RECOVERY', caseType: 'Litigation Cases', active: false, version: 1, stages: [], steps: [] };
      else if (endpoint === 'workflows/cases/matter-test') data = { _id: 'original-instance', caseId: 'matter-test', templateId: 'original-template', status: 'Active', steps: [] };
      else if (endpoint.endsWith('/earned-fees')) data = { contractValue: 600000, currency: 'RWF', completedPercent: 0, earnedValue: 0, stages: [], team: [] };
      else if (endpoint.endsWith('unread-count')) data = { unread: 0 };
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.stack); });
    const open = async () => {
      await page.goto(base + '/cases/matter-test');
      const edit = page.getByRole('button', { name: 'Edit Case', exact: true });
      await edit.waitFor({ state: 'visible' });
      await edit.click();
      await page.getByRole('dialog', { name: 'Edit Case' }).waitFor();
    };
    const dialog = page.getByRole('dialog', { name: 'Edit Case' });
    await open();
    for (const [index, label] of ['Legal Service', 'Category', 'Practice Area', 'Service Line'].entries()) {
      const input = dialog.getByLabel(label, { exact: true });
      assert.equal(await input.inputValue(), legalServicePath[index].label);
      assert.equal(await input.getAttribute('readonly'), '');
    }
    assert.equal(await dialog.getByLabel('Workflow Template', { exact: true }).inputValue(), 'DEBT RECOVERY');
    await dialog.getByLabel(/^Case Summary/).fill('Saved from edit form');
    await dialog.getByLabel(/^Initiator/).selectOption('New Initiator');
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].description, 'Saved from edit form');
    assert.equal(payloads[0].caseAssignments.initiator, 'New Initiator');
    for (const field of ['legalServicePath', 'workflowTemplateId', 'workflowInstanceId', 'workflow', 'matterType', 'caseType', 'workflowProgress', 'billingSettings']) assert(!(field in payloads[0]), field + ' must remain untouched');
    assert.equal(activeTemplateRequests, 0, 'Existing matters must not be rematched to active templates.');
    console.log('PASS: saved classification and inactive workflow render unchanged; editable details save without locked fields.');

    const output = path.resolve(__dirname, '../node_modules/.cache/case-edit-verification');
    fs.mkdirSync(output, { recursive: true });
    for (const theme of ['light', 'dark']) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await open();
        await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
        const layout = await dialog.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, height: element.getBoundingClientRect().height, viewportHeight: innerHeight }));
        assert(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout));
        assert(layout.left >= 0 && layout.right <= width && layout.height < layout.viewportHeight);
        await dialog.getByLabel('Service Line', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `case-edit-${theme}-${width}.png`) });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
      }
    }
    console.log('PASS: desktop/mobile light and dark layouts fit the viewport; Escape dismisses the dialog.');

    await page.setViewportSize({ width: 1440, height: 1000 });
    await open();
    rejectSave = true;
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await dialog.getByRole('alert').filter({ hasText: 'Synthetic save failure' }).waitFor();
    assert(await dialog.isVisible());
    rejectSave = false;
    await dialog.getByLabel(/^Contract Value/).fill('700000');
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(payloads.at(-1).workflowProgress, { plannedValue: { amount: 700000, currency: 'RWF' } });
    console.log('PASS: failed saves preserve the form; contract value updates send only the planned value.');

    matter = { ...structuredClone(original), legalServicePath: [...legalServicePath, { id: 'retired-sub', label: 'Saved sub-category' }, { id: 'retired-detail', label: 'Saved detail' }] };
    await open();
    assert.equal(await dialog.getByLabel('Sub-category', { exact: true }).inputValue(), 'Saved sub-category');
    assert.equal(await dialog.getByLabel('Detail', { exact: true }).inputValue(), 'Saved detail');
    await page.keyboard.press('Escape');
    matter = { ...structuredClone(original), legalServicePath: [] };
    await open();
    assert(await dialog.getByText('No classification was saved for this case.').isVisible());
    assert.equal(await dialog.getByRole('combobox').count(), 3, 'Missing classification must not require selecting a service.');
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log('PASS: all saved levels render, and legacy cases with no classification remain editable.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
