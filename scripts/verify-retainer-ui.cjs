/** Local browser fixtures only: no live account, payment or production API changes. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const express = require('../colin-backend/node_modules/express');
const { chromium } = require('../colin-backend/node_modules/playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const app = express(); app.use(express.static(path.join(root, 'build')));
  app.use((_req, res) => res.sendFile(path.join(root, 'build/index.html')));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  let browser, page;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking'] });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('token', 'local-fixture');
      localStorage.setItem('user', JSON.stringify({ id: '111111111111111111111111', name: 'Fixture Partner', role: 'managing_partner', email: 'fixture@test.invalid' }));
      const month = new Date().toISOString().slice(0, 7);
      const retainer = { _id: '333333333333333333333333', retainerNo: 'RET-2026-001', name: 'Corporate legal services', clientName: 'Kigali Industries Ltd', billingModel: 'monthly', status: 'Active', effectiveStatus: 'Active', isUsable: true, currency: 'RWF', startDate: `${month}-01`, monthlyFee: 1000000, billingDay: 1, contractValue: 0, totalFunded: 0, availableBalance: 0, reservedAmount: 0, scope: 'Corporate advisory and dispute resolution', scopeApprovalRequired: true };
      const staff = [{ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Alice Associate', role: 'associate' }, { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Bob Senior Associate', role: 'senior_associate' }];
      const allocation = { fixedFee: 1000000, actualReceived: 0, workValue: 0, allocableRevenue: 0, firmUnutilisedRevenue: 0, outstanding: 1000000, overpayment: 0, utilisation: 0, utilisationStatus: 'Underutilised', excessServiceValue: 0, substantialOverutilisation: false, staffTpa: 0, retainedAfterTpa: 0, mattersCount: 0, servicesCount: 0, departments: [{ department: 'Dispute Resolution', ordinaryValue: 0, share: 0, allocatedRevenue: 0 }, { department: 'Transaction & Advisory', ordinaryValue: 0, share: 0, allocatedRevenue: 0 }], services: [] };
      let period = null, saved = false;
      window.__retainerRequests = []; window.__rejectRetainerReceipt = false;
      const original = window.fetch.bind(window);
      window.fetch = async (input, options = {}) => {
        const url = String(input); if (!url.includes('/api/')) return original(input, options);
        const endpoint = new URL(url, location.origin).pathname;
        const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : undefined;
        window.__retainerRequests.push({ endpoint, method, body });
        const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
        const base = `/api/retainers/${retainer._id}`;
        if (endpoint === '/api/retainers' && method === 'GET') return reply([retainer]);
        if (endpoint === base) return reply(retainer);
        if (endpoint === `${base}/cases`) return reply({ cases: [], summary: { caseCount: 0, contractValue: 0, totalBilled: 0, totalCollected: 0, outstanding: 0, directMatterCosts: 0, grossProfit: 0, profitableCases: 0, lossMakingCases: 0 } });
        if (endpoint === `${base}/activity`) return reply([]);
        if (endpoint === `${base}/service-candidates`) return reply(saved ? [] : [{ caseId: 'cccccccccccccccccccccccc', matterNo: 'MAT-2026-104', actionKey: 'advisory', title: 'Corporate advisory review', performedOn: `${month}-02`, ordinaryFee: 1500000, department: 'Transaction & Advisory', assignedStaff: staff.map(s => s.name) }]);
        if (endpoint === `${base}/periods`) {
          if (method === 'POST') period = { _id: 'dddddddddddddddddddddddd', retainerId: retainer._id, clientName: retainer.clientName, retainerNo: retainer.retainerNo, month: body.month, dueDate: `${body.month}-01`, fixedFee: 1000000, status: 'Open', services: [], receipts: [], allocation, history: [] };
          return reply(method === 'POST' ? period : { periods: period ? [period] : [], staff, invoices: [] });
        }
        if (endpoint === `${base}/periods/dddddddddddddddddddddddd`) return reply(period);
        if (endpoint.endsWith('/services') && method === 'POST') {
          saved = true;
          const work = { _id: 'eeeeeeeeeeeeeeeeeeeeeeee', caseId: body.caseId, actionKey: body.actionKey, title: 'Corporate advisory review', matterNo: 'MAT-2026-104', performedOn: `${month}-02`, ordinaryFee: 1500000, department: body.department, allocatedRevenue: 0, approvedBy: 'Fixture Partner', contributors: [{ userId: staff[0]._id, name: staff[0].name, role: staff[0].role, share: 50, tpaPercent: 5, production: 750000, earnedTpa: 37500 }, { userId: staff[1]._id, name: staff[1].name, role: staff[1].role, share: 50, tpaPercent: 6, production: 750000, earnedTpa: 45000 }] };
          period.services.push(work); Object.assign(allocation, { workValue: 1500000, utilisation: 150, utilisationStatus: 'Overutilised', excessServiceValue: 500000, staffTpa: 82500, retainedAfterTpa: -82500, servicesCount: 1, mattersCount: 1, services: [work] });
          allocation.departments[1].ordinaryValue = 1500000; allocation.departments[1].share = 100;
          return reply(period);
        }
        if (endpoint.endsWith('/receipts') && method === 'POST') {
          if (window.__rejectRetainerReceipt) return reply({ message: 'This payment reference is already recorded.' }, 409);
          period.receipts.push({ _id: 'ffffffffffffffffffffffff', ...body });
          Object.assign(allocation, { actualReceived: 1000000, allocableRevenue: 1000000, outstanding: 0, retainedAfterTpa: 917500 });
          allocation.departments[1].allocatedRevenue = 1000000; allocation.services[0].allocatedRevenue = 1000000;
          return reply(period);
        }
        if (endpoint.endsWith('/actions/close')) { period.status = 'Closed'; return reply(period); }
        if (endpoint.endsWith('/notifications/unread-count')) return reply({ unread: 0 });
        return reply([]);
      };
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/matters/retainers`);
    await page.getByRole('button', { name: 'New retainer', exact: true }).click();
    const agreementForm = page.getByRole('dialog', { name: 'Create retainer agreement', exact: true });
    await agreementForm.waitFor();
    assert(await agreementForm.getByLabel('Fixed monthly fee', { exact: false }).isVisible());
    assert(await agreementForm.getByLabel('Retainer client', { exact: false }).isVisible());
    assert.equal(await agreementForm.getByRole('radiogroup').count(), 0);
    assert.equal(await agreementForm.getByText('Subscription contract', { exact: true }).count(), 0);
    assert.equal(await agreementForm.getByText('Hybrid agreement', { exact: true }).count(), 0);
    await agreementForm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goto(`${base}/matters/retainers/333333333333333333333333`);
    const statement = page.getByRole('region', { name: 'Monthly Retainer Statement' });
    await statement.locator('.ra-empty').getByRole('heading', { name: 'Monthly Retainer Statement', exact: true }).waitFor();
    await statement.getByRole('button', { name: 'Record fixed monthly fee', exact: true }).click();
    await statement.getByText('Fixed monthly fee', { exact: true }).waitFor();
    await statement.getByRole('button', { name: 'Record service', exact: true }).click();
    await statement.getByLabel('Approved workflow task', { exact: false }).selectOption('cccccccccccccccccccccccc:advisory');
    assert.equal(await statement.getByLabel('Department', { exact: false }).inputValue(), 'Transaction & Advisory');
    assert(await statement.getByLabel('Department', { exact: false }).isDisabled());
    assert.equal(await statement.getByLabel('Ordinary professional fee (RWF)', { exact: true }).inputValue(), '1500000');
    await statement.getByLabel('Staff member', { exact: false }).selectOption('aaaaaaaaaaaaaaaaaaaaaaaa');
    await statement.getByLabel('Contribution %', { exact: true }).fill('50');
    assert(await statement.getByRole('button', { name: 'Record approved workflow task', exact: true }).isDisabled());
    await statement.getByRole('button', { name: 'Add contributor', exact: true }).click();
    await statement.getByLabel('Staff member', { exact: false }).nth(1).selectOption('bbbbbbbbbbbbbbbbbbbbbbbb');
    await statement.getByLabel('Contribution %', { exact: true }).nth(1).fill('50');
    await statement.getByRole('button', { name: 'Record approved workflow task', exact: true }).click();
    await statement.getByRole('status').filter({ hasText: 'Approved workflow task recorded' }).waitFor();
    const serviceBody = await page.evaluate(() => window.__retainerRequests.find(r => r.endpoint.endsWith('/services') && r.method === 'POST').body);
    assert.deepEqual(serviceBody.contributors.map(c => c.share), [50, 50]);
    assert.equal(serviceBody.department, 'Transaction & Advisory');
    assert(await statement.getByText('RWF 82,500', { exact: true }).count());
    await statement.getByRole('button', { name: 'Record actual revenue received', exact: true }).click();
    await statement.getByLabel('Amount (RWF)', { exact: true }).fill('1000000');
    await statement.getByLabel('Bank / payment reference', { exact: true }).fill('BROWSER-TEST-ONLY');
    await statement.locator('form').filter({ hasText: 'Record actual revenue received' }).getByRole('button', { name: 'Record actual revenue received', exact: true }).click();
    await statement.getByRole('status').filter({ hasText: 'Actual revenue received recorded once' }).waitFor();
    assert(await statement.getByText('BROWSER-TEST-ONLY', { exact: true }).isVisible());
    const downloadEvent = page.waitForEvent('download');
    await statement.getByRole('button', { name: 'Export Monthly Retainer Statement', exact: true }).click();
    const download = await downloadEvent;
    assert(download.suggestedFilename().endsWith('.csv'));
    assert(fs.readFileSync(await download.path(), 'utf8').includes('Individual TPA'));
    await page.evaluate(() => { window.__rejectRetainerReceipt = true; });
    await statement.getByRole('button', { name: 'Record actual revenue received', exact: true }).click();
    await statement.getByLabel('Amount (RWF)', { exact: true }).fill('1000000');
    await statement.getByLabel('Bank / payment reference', { exact: true }).fill('BROWSER-TEST-ONLY');
    await statement.locator('form').filter({ hasText: 'Record actual revenue received' }).getByRole('button', { name: 'Record actual revenue received', exact: true }).click();
    await statement.getByRole('alert').filter({ hasText: 'already recorded' }).waitFor();
    assert.equal(await statement.getByLabel('Bank / payment reference', { exact: true }).inputValue(), 'BROWSER-TEST-ONLY');
    await statement.locator('form').filter({ hasText: 'Record actual revenue received' }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await statement.getByRole('button', { name: 'Close month', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.ra-status')?.textContent === 'Closed');
    assert(await statement.getByRole('button', { name: 'Record service', exact: true }).isDisabled());
    assert(await statement.getByRole('button', { name: 'Record actual revenue received', exact: true }).isEnabled());
    const output = path.join(root, 'node_modules/.cache/retainer-ui'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'Mobile page must not overflow horizontally.');
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: path.join(output, 'mobile-dark.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: month opening, service values, contributor validation, TPA display, receipt entry, duplicate error retention, CSV export, closure, mobile layout and dark mode.');
  } catch (error) {
    if (page) { const output = path.join(root, 'node_modules/.cache/retainer-ui'); fs.mkdirSync(output, { recursive: true }); await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); console.error((await page.locator('.retainer-accounting').innerText().catch(() => '')).slice(0, 7000)); }
    throw error;
  } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
