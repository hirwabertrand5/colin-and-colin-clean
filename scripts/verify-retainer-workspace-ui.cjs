/** Local synthetic API data only. No real client, account or payment changes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('../colin-backend/node_modules/express');
const { chromium } = require('../colin-backend/node_modules/playwright');

async function main() {
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'node_modules/.cache/retainer-workspace');
  fs.mkdirSync(output, { recursive: true });
  const app = express(); app.use(express.static(path.join(root, 'build'))); app.use((_req, res) => res.sendFile(path.join(root, 'build/index.html')));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser, page;
  const id = '333333333333333333333333';
  let agreement = { _id: id, retainerNo: 'RET-2026-00015', name: 'Annual legal services', clientName: 'Kigali Industries Ltd', billingModel: 'monthly', status: 'Active', effectiveStatus: 'Active', isUsable: true, startDate: '2026-01-01', endDate: '2028-12-31', renewalDate: '2027-12-01', monthlyFee: 1000000, billingDay: 14, scope: 'Corporate advisory and dispute resolution.', notes: 'Review services each quarter.', contractValue: 0 };
  let created, rejectSave = false;
  const requests = [];
  const team = (timeliness, quality, base) => ['Alice Associate', 'Bob Senior Associate', 'Managing Partner'].map((name, index) => ({ key: name, name, role: ['Initiator', 'Reviewer', 'Signer/Approver'][index], userRole: ['associate', 'senior_associate', 'managing_partner'][index], tpaPercent: [5, 6, 10][index], timelinessScore: timeliness, qualityScore: quality, taskFeeCollected: base, earnedFee: timeliness == null || quality == null ? null : Math.round(base * [5, 6, 10][index] / 100 * timeliness / 100 * quality / 100), isCurrentAssignment: true }));
  const matter = (number, name, department, billed, collected, costs, members) => {
    const known = members.filter(member => member.earnedFee != null);
    const staffEarnedFees = known.length ? known.reduce((sum, member) => sum + member.earnedFee, 0) : null;
    return { _id: String(number).repeat(24), caseNo: 'MAT-2026-00' + number, parties: name, department, status: number === 2 ? 'Closed' : 'In Progress', contractValue: 2000000, totalBilled: billed, totalCollected: collected, outstanding: billed - collected, directMatterCosts: costs, grossProfit: collected - costs, profitStatus: 'Profitable', team: members, staffEarnedFees, pendingStaffCount: members.length - known.length, netAfterStaff: collected - costs - (staffEarnedFees || 0), retainerId: id };
  };
  let cases = [matter(1, 'Employment dispute', 'Dispute Resolution', 700000, 500000, 25000, team(90, 80, 500000)), matter(2, 'Corporate advice', 'Transaction & Advisory', 1000000, 1000000, 5000, team(80, 100, 1000000)), matter(4, 'Pending dispute', 'Dispute Resolution', 0, 0, 0, team(null, null, 0))];
  const available = { ...matter(5, 'New advisory case', 'Transaction & Advisory', 0, 0, 0, team(0, 100, 0)), retainerId: undefined };
  const response = (rows) => ({ cases: rows, summary: { caseCount: rows.length, contractValue: rows.reduce((sum, item) => sum + item.contractValue, 0), totalBilled: rows.reduce((sum, item) => sum + item.totalBilled, 0), totalCollected: rows.reduce((sum, item) => sum + item.totalCollected, 0), outstanding: rows.reduce((sum, item) => sum + item.outstanding, 0), directMatterCosts: rows.reduce((sum, item) => sum + item.directMatterCosts, 0), grossProfit: rows.reduce((sum, item) => sum + item.grossProfit, 0), profitableCases: 2, lossMakingCases: 0, staffEarnedFees: rows.reduce((sum, item) => sum + (item.staffEarnedFees || 0), 0), pendingStaffCount: rows.reduce((sum, item) => sum + item.pendingStaffCount, 0), netAfterStaff: rows.reduce((sum, item) => sum + item.netAfterStaff, 0), staffCount: rows.length ? 3 : 0 } });
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('token', 'local-test'); localStorage.setItem('user', JSON.stringify({ id: '111111111111111111111111', name: 'Managing Partner', email: 'test@retainer.invalid', role: 'managing_partner' })); });
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.includes('/api/')) return url.origin === origin ? route.continue() : route.abort();
      const endpoint = url.pathname.split('/api/')[1], method = request.method(), body = request.postDataJSON();
      requests.push({ endpoint, method, body });
      const send = (json, status = 200) => route.fulfill({ json, status });
      if (endpoint === 'retainers') {
        if (method === 'POST') { created = { ...agreement, ...body, _id: '666666666666666666666666', retainerNo: 'RET-2026-NEW', effectiveStatus: body.status }; return send(created, 201); }
        return send([agreement]);
      }
      if (endpoint === 'retainers/' + id) {
        if (method === 'PUT') { if (rejectSave) return send({ message: 'Synthetic fee update failed.' }, 400); agreement = { ...agreement, ...body, effectiveStatus: body.status }; }
        return send(agreement);
      }
      if (created && endpoint === 'retainers/' + created._id) return send(created);
      if (endpoint === 'retainers/' + id + '/cases') return send(response(cases));
      if (created && endpoint === 'retainers/' + created._id + '/cases') return send(response([]));
      if (endpoint.endsWith('/activity')) return send([]);
      if (endpoint.startsWith('retainers/cases/') && endpoint.endsWith('/link')) {
        const caseId = endpoint.split('/')[2];
        if (body.retainerId) cases.push({ ...available, retainerId: id }); else cases = cases.filter(matter => matter._id !== caseId);
        return send({});
      }
      if (endpoint === 'cases') return send([...cases, available]);
      if (endpoint.endsWith('unread-count')) return send({ unread: 0 });
      return send([]);
    });
    await page.goto(origin + '/matters/retainers/' + id);
    const fee = page.getByRole('region', { name: 'Fixed monthly retainer fee', exact: true });
    await fee.getByText('RWF 1,000,000', { exact: true }).waitFor();
    assert(await fee.getByText('Day 14 of each month', { exact: true }).isVisible());
    const kpis = page.getByRole('region', { name: 'Retainer case totals', exact: true });
    const metric = label => kpis.locator('.rw-kpi').filter({ has: page.getByText(label, { exact: true }) }).locator('strong');
    assert.equal(await metric('Linked cases').innerText(), '3');
    assert.equal(await metric('Case fees collected').innerText(), 'RWF 1,500,000');
    assert.equal(await metric('Staff fees earned').innerText(), 'RWF 243,600');
    assert.equal(await metric('Net contribution').innerText(), 'RWF 1,226,400');
    const departments = page.getByRole('region', { name: 'Department performance', exact: true });
    const dispute = departments.getByRole('article', { name: 'Dispute Resolution', exact: true });
    assert(await dispute.getByText('2 linked cases', { exact: true }).isVisible());
    assert.equal(await dispute.locator('.rw-department-revenue strong').innerText(), 'RWF 500,000');
    assert.equal(await dispute.locator('.rw-department-figures dd').first().innerText(), 'RWF 75,600');
    const advisory = departments.getByRole('article', { name: 'Transaction & Advisory', exact: true });
    assert.equal(await advisory.locator('.rw-department-revenue strong').innerText(), 'RWF 1,000,000');
    const staff = page.getByRole('region', { name: 'Staff earnings', exact: true });
    const alice = staff.locator('tbody tr').filter({ has: page.getByText('Alice Associate', { exact: true }) });
    assert.deepEqual(await alice.locator('td').allTextContents(), ['3', '5%', '85%', '90%', 'RWF 58,0001 pending role row']);
    const linked = page.getByRole('region', { name: 'Linked case performance', exact: true });
    const teamTable = linked.getByRole('table', { name: 'Employment dispute team earnings', exact: true });
    assert.deepEqual(await teamTable.locator('thead th').allTextContents(), ['Role', 'Team member', 'TPA', 'Timeliness', 'Quality', 'Collected base', 'Earned fee']);
    assert.equal(await teamTable.locator('tbody tr').nth(0).innerText(), 'Initiator\tAlice Associate\t5%\t90%\t80%\tRWF 500,000\tRWF 18,000');
    await linked.getByRole('button', { name: 'Show team for Pending dispute', exact: true }).click();
    const waiting = linked.getByRole('table', { name: 'Pending dispute team earnings', exact: true });
    assert.equal(await waiting.locator('tbody tr').nth(0).locator('td').last().innerText(), '_');
    await linked.getByLabel('Filter cases by department').selectOption('Transaction & Advisory');
    assert.equal(await linked.getByRole('link', { name: 'Corporate advice', exact: true }).count(), 1);
    assert.equal(await linked.getByRole('link', { name: 'Employment dispute', exact: true }).count(), 0);
    await linked.getByLabel('Filter cases by department').selectOption('');
    await linked.getByLabel('Search linked cases or staff').fill('Pending dispute');
    assert.equal(await linked.getByRole('link', { name: 'Employment dispute', exact: true }).count(), 0);
    await linked.getByLabel('Search linked cases or staff').fill('');
    await page.getByRole('button', { name: 'Edit agreement', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit retainer agreement', exact: true });
    assert.equal(await edit.locator('input,select,textarea').count(), 10);
    assert.equal(await edit.getByRole('radiogroup').count(), 0);
    assert.equal(await edit.getByLabel('Responsible partner').count(), 0);
    await page.screenshot({ path: path.join(output, 'desktop-form.png') });
    await edit.getByLabel('Fixed monthly fee', { exact: true }).fill('2000000');
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click(); await edit.waitFor({ state: 'hidden' });
    await fee.getByText('RWF 2,000,000', { exact: true }).waitFor();
    assert.equal(await metric('Case fees collected').innerText(), 'RWF 1,500,000', 'Fixed monthly fee must not be added to paid case invoices');
    rejectSave = true;
    await page.getByRole('button', { name: 'Edit agreement', exact: true }).click();
    await edit.getByLabel('Fixed monthly fee', { exact: true }).fill('2500000');
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
    await edit.getByRole('alert').filter({ hasText: 'Synthetic fee update failed.' }).waitFor();
    assert.equal(await edit.getByLabel('Fixed monthly fee', { exact: true }).inputValue(), '2500000');
    await edit.press('Escape'); await edit.waitFor({ state: 'hidden' }); rejectSave = false;
    page.once('dialog', dialog => dialog.accept());
    await linked.getByRole('button', { name: 'Unlink Pending dispute', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Case unlinked.' }).waitFor();
    assert.equal(await metric('Linked cases').innerText(), '2');
    await linked.getByRole('button', { name: 'Link a case', exact: true }).click();
    const linker = page.getByRole('region', { name: 'Link a case', exact: true });
    await linker.getByLabel('Find a case', { exact: true }).fill('New advisory');
    await linker.getByLabel('Matching cases', { exact: true }).selectOption(available._id);
    await linker.getByRole('button', { name: 'Link case', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Case linked.' }).waitFor();
    assert.equal(await metric('Linked cases').innerText(), '3');
    await linked.getByRole('button', { name: 'Show team for New advisory case', exact: true }).click();
    const zeroFees = linked.getByRole('table', { name: 'New advisory case team earnings', exact: true });
    assert.equal(await zeroFees.locator('tbody tr').first().locator('td').nth(2).innerText(), '0%');
    assert.equal(await zeroFees.locator('tbody tr').first().locator('td').last().innerText(), 'RWF 0');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'desktop-light.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: path.join(output, 'desktop-dark.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 2, undefined, { timeout: 5000 }).catch(async error => {
      console.error('Mobile overflow:', await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 2 && !element.closest('.rw-table-scroll')).slice(0, 18).map(element => ({ tag: element.tagName, className: element.className, width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right })) })));
      throw error;
    });
    await page.screenshot({ path: path.join(output, 'mobile-dark.png'), fullPage: true });
    await page.goto(origin + '/matters/retainers');
    await page.getByRole('button', { name: 'New retainer', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Create retainer agreement', exact: true });
    assert.equal(await create.locator('input,select,textarea').count(), 10);
    for (const unwanted of ['Responsible partner', 'Contract value', 'Billing model', 'Monthly utilisation threshold (%)']) assert.equal(await create.getByLabel(unwanted, { exact: true }).count(), 0);
    await create.getByLabel('Retainer agreement', { exact: true }).fill('New annual agreement');
    await create.getByLabel('Retainer client', { exact: true }).fill('New client');
    await create.getByLabel('Status', { exact: true }).selectOption('Active');
    await create.getByLabel('Start date', { exact: true }).fill('2026-01-01');
    await create.getByLabel('End date', { exact: true }).fill('2028-12-31');
    await create.getByLabel('Renewal review', { exact: true }).fill('2027-12-01');
    await create.getByLabel('Fixed monthly fee', { exact: true }).fill('500000');
    await create.getByLabel('Billing day', { exact: true }).fill('12');
    await create.getByLabel('Services covered', { exact: true }).fill('Advice and disputes.');
    await create.getByLabel('Internal notes', { exact: true }).fill('Annual review.');
    assert(await create.evaluate(element => element.scrollWidth <= element.clientWidth + 2), 'Mobile form must not overflow');
    const formHeader = await create.locator('.rw-form-header').boundingBox(), formFooter = await create.locator('.rw-form-footer').boundingBox();
    assert(formHeader.y >= 0 && formHeader.y < 40, 'Form header remains visible when scrolling fields');
    assert(formFooter.y + formFooter.height <= 844, 'Form actions stay within the phone viewport');
    await page.screenshot({ path: path.join(output, 'mobile-form.png') });
    await create.getByRole('button', { name: 'Create retainer', exact: true }).click();
    await page.getByRole('heading', { name: 'New annual agreement', exact: true }).waitFor();
    assert(await page.getByRole('region', { name: 'Fixed monthly retainer fee' }).getByText('RWF 500,000', { exact: true }).isVisible());
    const payload = requests.find(request => request.endpoint === 'retainers' && request.method === 'POST').body;
    assert.equal(payload.billingModel, 'monthly'); assert(!Object.hasOwn(payload, 'responsiblePartner'));
    assert.deepEqual(errors, []);
    console.log('PASS: fixed fee prominence, department totals, staff names/earnings/scores, original role table, pending fees, search/filter, fee edits, form errors, link/unlink refresh, exact form fields, create redirect, mobile layout and dark mode.');
  } catch (error) { if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); throw error; }
  finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
