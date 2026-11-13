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
      const cases = [
        { _id: 'cccccccccccccccccccccccc', caseNo: 'MAT-2026-104', parties: 'Corporate advisory matter', department: 'Transaction & Advisory', status: 'Closed' },
        { _id: '121212121212121212121212', caseNo: 'MAT-2026-105', parties: 'Client employment dispute', department: 'Dispute Resolution', status: 'Open' },
        { _id: '131313131313131313131313', caseNo: 'N/A', parties: 'Company registration', department: 'Transaction & Advisory', status: 'Open' },
      ];
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
        if (endpoint === base) { if (method === 'PUT') Object.assign(retainer, body, { updatedAt: new Date().toISOString() }); return reply(retainer); }
        if (endpoint === `${base}/cases`) {
          const a = period?.allocation || allocation;
          const rows = cases.map((matter, index) => {
            const work = a.services.filter(service => service.caseId === matter._id);
            const contributors = new Map();
            for (const service of work) for (const member of service.contributors) {
              const prior = contributors.get(member.userId);
              contributors.set(member.userId, { userId: member.userId, name: member.name, earnedTpa: (prior?.earnedTpa || 0) + member.earnedTpa });
            }
            const staffTpa = [...contributors.values()].reduce((sum, member) => sum + member.earnedTpa, 0);
            const retainerRevenue = work.reduce((sum, service) => sum + service.allocatedRevenue, 0);
            const directMatterCosts = [25000, 10000, 0][index];
            const team = index === 2 ? [] : [
              { key: 'initiator-alice', role: 'Initiator', name: 'Alice Associate', userRole: 'associate', tpaPercent: 5, timelinessScore: null, qualityScore: null, taskFeeCollected: 0, earnedFee: null, isCurrentAssignment: true },
              { key: 'reviewer-bob', role: 'Reviewer', name: 'Bob Senior Associate', userRole: 'senior_associate', tpaPercent: 6, timelinessScore: index ? 0 : null, qualityScore: index ? 80 : null, taskFeeCollected: index ? 200000 : 0, earnedFee: index ? 0 : null, isCurrentAssignment: true },
              { key: 'approver-partner', role: 'Signer/Approver', name: 'Fixture Partner', userRole: 'managing_partner', tpaPercent: 10, timelinessScore: null, qualityScore: null, taskFeeCollected: 0, earnedFee: null, isCurrentAssignment: true },
            ];
            return { ...matter, team, caseStaffEarnedTotal: index === 1 ? 0 : null, ordinaryWorkValue: work.reduce((sum, service) => sum + service.ordinaryFee, 0), retainerRevenue, directMatterCosts, staffTpa, servicesCount: work.length, contributors: [...contributors.values()], netContribution: retainerRevenue - directMatterCosts - staffTpa };
          });
          return reply({ cases: rows, accounting: { ...a, recordedMonths: period ? 1 : 0, fixedFees: period ? a.fixedFee : 0, outstanding: period ? a.outstanding : 0 } });
        }
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
          // Repeated work on one case, two departments and historical rates exercise
          // monthly aggregation independently of the service entry form.
          const extra = [
            { ...work, _id: '141414141414141414141414', title: 'Follow-up advice', ordinaryFee: 100000, contributors: [{ ...work.contributors[0], share: 100, production: 100000, tpaPercent: 6, earnedTpa: 6000 }] },
            { ...work, _id: '151515151515151515151515', caseId: cases[1]._id, matterNo: cases[1].caseNo, title: 'Labour submissions', department: cases[1].department, ordinaryFee: 500000, contributors: [{ ...work.contributors[0], share: 100, production: 500000, earnedTpa: 25000 }] },
            { ...work, _id: '161616161616161616161616', caseId: cases[2]._id, matterNo: cases[2].caseNo, title: 'Company registration', ordinaryFee: 300000, contributors: [{ ...work.contributors[1], share: 100, production: 300000, earnedTpa: 18000 }] },
          ];
          const reversed = { ...work, _id: '171717171717171717171717', title: 'Reversed historical task', ordinaryFee: 999999, voidedAt: new Date().toISOString() };
          period.services.push(work, ...extra, reversed);
          Object.assign(allocation, { workValue: 2400000, utilisation: 240, utilisationStatus: 'Overutilised', excessServiceValue: 1400000, substantialOverutilisation: true, staffTpa: 131500, retainedAfterTpa: -131500, servicesCount: 4, mattersCount: 3, services: [work, ...extra] });
          Object.assign(allocation.departments[0], { ordinaryValue: 500000, share: 20.83 });
          Object.assign(allocation.departments[1], { ordinaryValue: 1900000, share: 79.17 });
          return reply(period);
        }
        if (endpoint.endsWith('/receipts') && method === 'POST') {
          if (window.__rejectRetainerReceipt) return reply({ message: 'This payment reference is already recorded.' }, 409);
          period.receipts.push({ _id: 'ffffffffffffffffffffffff', ...body });
          Object.assign(allocation, { actualReceived: 1000000, allocableRevenue: 1000000, outstanding: 0, retainedAfterTpa: 868500 });
          allocation.departments[0].allocatedRevenue = 208333; allocation.departments[1].allocatedRevenue = 791667;
          allocation.services.forEach((service, index) => { service.allocatedRevenue = [625000, 41667, 208333, 125000][index]; });
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
    for (const removed of ['Responsible partner', 'Retainer utilisation', 'Services excluded', 'Monthly utilisation threshold (%)', 'Additional work is separately chargeable', 'Approval required for work exceeding the agreed scope']) assert.equal(await agreementForm.getByText(removed, { exact: true }).count(), 0);
    await agreementForm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goto(`${base}/matters/retainers/333333333333333333333333`);
    const overview = page.getByRole('region', { name: 'Retainer financial overview', exact: true });
    await overview.getByRole('heading', { name: 'Retainer performance', exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Linked matters', exact: true }).getByRole('link').count(), 3);
    const caseTeams = overview.getByRole('region', { name: 'Case teams and earned fees', exact: true });
    const advisoryTeam = caseTeams.getByRole('table', { name: 'Corporate advisory matter team earnings', exact: true });
    assert.deepEqual(await advisoryTeam.locator('thead th').allTextContents(), ['Role', 'Team member', 'TPA', 'Timeliness', 'Quality', 'Collected base', 'Earned fee']);
    assert.deepEqual(await advisoryTeam.locator('tbody tr').nth(0).locator('td').allTextContents(), ['Initiator', 'Alice Associate', '5%', '_', '_', 'RWF 0', '_']);
    assert.deepEqual(await advisoryTeam.locator('tbody tr').nth(1).locator('td').allTextContents(), ['Reviewer', 'Bob Senior Associate', '6%', '_', '_', 'RWF 0', '_']);
    assert.deepEqual(await advisoryTeam.locator('tbody tr').nth(2).locator('td').allTextContents(), ['Signer/Approver', 'Fixture Partner', '10%', '_', '_', 'RWF 0', '_']);
    const scoredTeam = caseTeams.getByRole('table', { name: 'Client employment dispute team earnings', exact: true });
    assert.deepEqual(await scoredTeam.locator('tbody tr').nth(1).locator('td').allTextContents(), ['Reviewer', 'Bob Senior Associate', '6%', '0%', '80%', 'RWF 200,000', 'RWF 0']);
    const unassignedTeam = caseTeams.getByRole('table', { name: 'Company registration team earnings', exact: true });
    assert.equal(await unassignedTeam.getByText('Not assigned', { exact: true }).count(), 3);
    await page.getByRole('button', { name: 'Edit agreement', exact: true }).click();
    const editForm = page.getByRole('dialog', { name: 'Edit retainer agreement', exact: true });
    await editForm.getByLabel('Billing day', { exact: false }).fill('14');
    await editForm.getByLabel('Renewal review', { exact: false }).fill('2027-12-01');
    await editForm.getByLabel('End date', { exact: false }).fill('2028-12-31');
    assert.equal(await editForm.getByLabel('Responsible partner', { exact: true }).count(), 0);
    await editForm.getByLabel('Internal notes', { exact: false }).fill('Review the client portfolio each quarter.');
    await editForm.getByLabel('Services covered', { exact: false }).fill('Corporate advisory and dispute resolution.');
    await editForm.getByRole('button', { name: 'Save changes', exact: true }).click();
    await editForm.waitFor({ state: 'hidden' });
    const agreementOverview = page.getByRole('region', { name: 'Agreement overview', exact: true });
    for (const text of ['Billing day: 14 of each month', '1 Dec 2027', '31 Dec 2028', 'Review the client portfolio each quarter.', 'Corporate advisory and dispute resolution.']) assert(await agreementOverview.getByText(text, { exact: true }).isVisible());
    assert.equal(await agreementOverview.getByText('Responsible partner', { exact: true }).count(), 0);
    const editBody = await page.evaluate(() => window.__retainerRequests.find(r => r.method === 'PUT').body);
    for (const removed of ['responsiblePartner', 'excludedServices', 'utilisationThreshold', 'additionalWorkChargeable', 'scopeApprovalRequired']) assert(!Object.hasOwn(editBody, removed));
    await page.getByRole('tab', { name: 'Monthly statements', exact: true }).click();
    const statement = page.getByRole('region', { name: 'Monthly Retainer Statement' });
    await statement.locator('.ra-empty').getByRole('heading', { name: 'Prepare this month’s statement', exact: true }).waitFor();
    const departments = statement.getByRole('region', { name: 'Department summary', exact: true });
    const earnings = statement.getByRole('region', { name: 'Staff earnings by case', exact: true });
    assert.deepEqual(await departments.locator('tbody tr').nth(1).locator('td').allTextContents(), ['2', '—', '—', '—', '—', '—']);
    assert.equal(await page.getByRole('columnheader', { name: 'Billed', exact: true }).count(), 0);
    assert.equal(await page.getByRole('columnheader', { name: 'Result', exact: true }).count(), 0);
    await statement.getByRole('button', { name: 'Record fixed monthly fee', exact: true }).click();
    await statement.getByText('Fixed monthly fee', { exact: true }).waitFor();
    assert(await earnings.getByText('No staff TPA recorded for this month.', { exact: false }).isVisible());
    await statement.getByRole('button', { name: 'Record service', exact: true }).click();
    await statement.getByLabel('Approved workflow task', { exact: false }).selectOption('cccccccccccccccccccccccc:advisory');
    assert.equal(await statement.getByRole('combobox', { name: /Department/ }).inputValue(), 'Transaction & Advisory');
    assert(await statement.getByRole('combobox', { name: /Department/ }).isDisabled());
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
    assert(await statement.getByText('RWF 131,500', { exact: true }).count());
    assert.deepEqual(await departments.locator('tbody tr').nth(0).locator('td').allTextContents(), ['1', '1', 'RWF 500,000', '20.83%', 'RWF 0', 'RWF 25,000']);
    assert.deepEqual(await departments.locator('tbody tr').nth(1).locator('td').allTextContents(), ['2', '3', 'RWF 1,900,000', '79.17%', 'RWF 0', 'RWF 106,500']);
    const aliceRow = earnings.locator('tr').filter({ has: page.getByRole('button', { name: 'Alice Associate associate', exact: true }) });
    assert.deepEqual(await aliceRow.locator(':scope > td').allTextContents(), ['2', '3', 'RWF 1,350,000', 'RWF 68,500']);
    await earnings.getByRole('button', { name: 'Alice Associate associate', exact: true }).click();
    const aliceCases = earnings.getByRole('table', { name: 'Alice Associate case earnings', exact: true });
    assert.deepEqual(await aliceCases.locator('tbody tr').nth(0).locator('td').allTextContents(), ['Corporate advisory matterMAT-2026-104', 'Transaction & Advisory', '2', 'RWF 850,000', '5%, 6%', 'RWF 43,500']);
    assert.equal(await aliceCases.locator('tbody tr').count(), 2);
    await earnings.getByRole('button', { name: 'Bob Senior Associate senior associate', exact: true }).click();
    const bobCases = earnings.getByRole('table', { name: 'Bob Senior Associate case earnings', exact: true });
    assert(await bobCases.getByRole('link', { name: 'Company registration', exact: true }).isVisible());
    assert.equal(await bobCases.getByRole('link', { name: 'Company registration', exact: true }).getAttribute('href'), '/cases/131313131313131313131313');
    const selectedMonth = await statement.getByLabel('Month', { exact: true }).inputValue();
    const nextMonthDate = new Date(`${selectedMonth}-01T12:00:00Z`); nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
    await statement.getByLabel('Month', { exact: true }).fill(nextMonthDate.toISOString().slice(0, 7));
    assert.equal(await earnings.getByRole('button', { name: 'Alice Associate associate', exact: true }).count(), 0);
    assert(await statement.getByRole('button', { name: 'Record fixed monthly fee', exact: true }).isVisible());
    await statement.getByLabel('Recorded statements', { exact: true }).selectOption('dddddddddddddddddddddddd');
    await earnings.getByRole('button', { name: 'Alice Associate associate', exact: true }).waitFor();
    assert.equal(await statement.getByLabel('Month', { exact: true }).inputValue(), selectedMonth);
    await earnings.getByRole('button', { name: 'Alice Associate associate', exact: true }).click();
    await statement.getByRole('button', { name: 'Record actual revenue received', exact: true }).click();
    await statement.getByLabel('Amount (RWF)', { exact: true }).fill('1000000');
    await statement.getByLabel('Bank / payment reference', { exact: true }).fill('BROWSER-TEST-ONLY');
    await statement.locator('form').filter({ hasText: 'Record actual revenue received' }).getByRole('button', { name: 'Record actual revenue received', exact: true }).click();
    await statement.getByRole('status').filter({ hasText: 'Actual revenue received recorded once' }).waitFor();
    assert(await statement.getByText('BROWSER-TEST-ONLY', { exact: true }).isVisible());
    assert.equal(await departments.locator('tbody tr').nth(0).locator('td').nth(4).innerText(), 'RWF 208,333');
    assert.equal(await departments.locator('tbody tr').nth(1).locator('td').nth(4).innerText(), 'RWF 791,667');
    const downloadEvent = page.waitForEvent('download');
    await statement.getByRole('button', { name: 'Export Monthly Retainer Statement', exact: true }).click();
    const download = await downloadEvent;
    assert(download.suggestedFilename().endsWith('.csv'));
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert(csv.includes('Individual TPA'));
    assert(csv.includes('"Alice Associate","2","3","1350000","68500"'));
    assert(csv.includes('"Alice Associate","MAT-2026-104","Corporate advisory matter","Transaction & Advisory","2","850000","5, 6","43500"'));
    assert(!csv.includes('Reversed historical task'));
    await page.evaluate(() => { window.__rejectRetainerReceipt = true; });
    await statement.getByRole('button', { name: 'Record actual revenue received', exact: true }).click();
    await statement.getByLabel('Amount (RWF)', { exact: true }).fill('1000000');
    await statement.getByLabel('Bank / payment reference', { exact: true }).fill('BROWSER-TEST-ONLY');
    await statement.locator('form').filter({ hasText: 'Record actual revenue received' }).getByRole('button', { name: 'Record actual revenue received', exact: true }).click();
    await statement.getByRole('alert').filter({ hasText: 'already recorded' }).waitFor();
    assert.equal(await statement.getByLabel('Bank / payment reference', { exact: true }).inputValue(), 'BROWSER-TEST-ONLY');
    await statement.locator('form').filter({ hasText: 'Record actual revenue received' }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await statement.getByRole('button', { name: 'Close month', exact: true }).click();
    await statement.locator('.ra-toolbar > .ra-status').filter({ hasText: 'Closed' }).waitFor();
    assert(await statement.getByRole('button', { name: 'Record service', exact: true }).isDisabled());
    assert(await statement.getByRole('button', { name: 'Record actual revenue received', exact: true }).isEnabled());
    await page.getByRole('tab', { name: 'Workspace overview', exact: true }).click();
    assert(await advisoryTeam.getByText('Alice Associate', { exact: true }).isVisible());
    const advisoryTeamCard = caseTeams.locator('.ra-case-team').filter({ has: page.getByRole('table', { name: 'Corporate advisory matter team earnings', exact: true }) });
    assert((await advisoryTeamCard.locator('.ra-case-retainer-earnings').innerText()).includes('Recorded retainer TPA: RWF 88,500'));
    const overviewMetric = label => overview.locator('.ra-metric').filter({ has: page.getByText(label, { exact: true }) }).locator('strong');
    assert.equal(await overviewMetric('Revenue received').innerText(), 'RWF 1,000,000');
    assert.equal(await overviewMetric('Work delivered').innerText(), 'RWF 2,400,000');
    assert.equal(await overviewMetric('Staff earnings (TPA)').innerText(), 'RWF 131,500');
    assert.equal(await overviewMetric('Linked case expenses').innerText(), 'RWF 35,000');
    assert.equal(await overviewMetric('Net after costs and TPA').innerText(), 'RWF 833,500');
    const overviewDepartments = overview.getByRole('region', { name: 'Department summary', exact: true });
    assert.deepEqual(await overviewDepartments.locator('tbody tr').nth(0).locator('td').allTextContents(), ['1', '1', 'RWF 500,000', '20.83%', 'RWF 208,333', 'RWF 25,000', 'RWF 10,000', 'RWF 173,333']);
    assert.deepEqual(await overviewDepartments.locator('tbody tr').nth(1).locator('td').allTextContents(), ['2', '3', 'RWF 1,900,000', '79.17%', 'RWF 791,667', 'RWF 106,500', 'RWF 25,000', 'RWF 660,167']);
    const caseSummary = page.getByRole('region', { name: 'Linked matters', exact: true });
    const advisoryCase = caseSummary.locator('tbody tr').filter({ has: page.getByRole('link', { name: 'Corporate advisory matter', exact: true }) });
    assert.equal(await advisoryCase.locator('td').nth(2).innerText(), 'RWF 1,600,000');
    assert.equal(await advisoryCase.locator('td').nth(3).innerText(), 'RWF 666,667');
    assert.equal(await advisoryCase.locator('td').nth(4).innerText(), 'RWF 25,000');
    assert((await advisoryCase.locator('td').nth(5).innerText()).includes('Alice Associate · RWF 43,500'));
    assert((await advisoryCase.locator('td').nth(5).innerText()).includes('Bob Senior Associate · RWF 45,000'));
    assert.equal(await advisoryCase.locator('td').nth(6).innerText(), 'RWF 553,167');
    await overview.getByRole('button', { name: 'Alice Associate associate', exact: true }).click();
    assert(await overview.getByRole('table', { name: 'Alice Associate case earnings', exact: true }).isVisible());
    const output = path.join(root, 'node_modules/.cache/retainer-ui'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mobileOverflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 2).slice(0, 16).map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })) }));
    if (mobileOverflow.scrollWidth > mobileOverflow.width + 2) console.error('Mobile overflow:', JSON.stringify(mobileOverflow));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'Mobile page must not overflow horizontally.');
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: path.join(output, 'mobile-dark.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: simplified form, saved agreement details, live workspace totals, case expenses and net contribution, department totals, staff earnings per case, historical TPA rates, reversals, month switching, receipts, CSV, closure, mobile layout and dark mode.');
  } catch (error) {
    if (page) { const output = path.join(root, 'node_modules/.cache/retainer-ui'); fs.mkdirSync(output, { recursive: true }); await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); console.error((await page.locator('.retainer-accounting').first().innerText().catch(() => '')).slice(0, 7000)); }
    throw error;
  } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
