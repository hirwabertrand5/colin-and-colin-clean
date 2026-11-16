/** Production assets + intercepted synthetic API only. No production access. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const express = require('../colin-backend/node_modules/express');
const { chromium } = require('../colin-backend/node_modules/playwright');

async function main() {
  const web = express();
  web.use(express.static(path.resolve(__dirname, '../build')));
  web.use((_req, res) => res.sendFile(path.resolve(__dirname, '../build/index.html')));
  const server = web.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1050 }, acceptDownloads: true });
    const errors = [], requests = [], timings = [], cancelled = [];
    let fail = false, revision = 0, transientFailures = 0, slowNext = false;
    const actor = { id: '111111111111111111111111', name: 'Finance Manager', role: 'managing_director', email: 'finance@ui.invalid' };
    await page.addInitScript(actor => { localStorage.setItem('token', 'isolated-finance-token'); localStorage.setItem('user', JSON.stringify(actor)); }, actor);
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', request => { if (request.url().includes('/billing/workspace/')) cancelled.push(request.url()); });
    const response = (section, url) => {
      const range = url.searchParams.get('range') || 'ytd';
      const tab = url.searchParams.get('tab') || 'all';
      const value = ({ daily: 111, weekly: 222, monthly: 333, quarterly: 444, yearly: 555, ytd: 666, custom: 777 })[range] + revision;
      const metrics = { contractValue: 20000, billed: 10000, collected: value, outstanding: 4400, overdue: 400, directCosts: 50,
        operatingExpenses: 40, grossProfit: value - 50, netProfit: value - 90, grossMargin: 80, netMargin: 70, collectionRate: 66.6,
        invoiceSettlementRate: 60, invoiceCount: 13, paidCount: 9, pendingCount: 4, periodOverdueCount: 1, periodOutstanding: 4400,
        averageInvoice: 1000, averageDebtorAge: 20, missingDueDates: 1, periodInflow: value, periodOutflow: 90, netCashFlow: value - 90,
        pettyCash: 800, monthlyExpenseRunRate: 250, openingMovement: 100, closingMovement: 700, grossExpenses: 100, refunds: 10,
        totalExpenses: 90, earnedFee: value, eligibleBase: 1500, unfundedBase: 500, awaitingInput: 1, actions: 13, staffCount: 13 };
      let rows = Array.from({ length: 13 }, (_, i) => ({ id: `record-${i}`, reference: `Invoice ${String(i + 1).padStart(2, '0')}`,
        recordType: 'invoice', caseId: '222222222222222222222222', matterNo: `MAT-${i}`, client: `Client ${i}`, amount: 1000 + i,
        date: '2026-11-02', dueDate: '2026-11-10', recorded: '2026-11-02T08:00:00Z', status: i % 2 ? 'Paid' : 'Pending', age: i,
        contractValue: 2000, billed: 1000, collected: value + i, outstanding: 300, directCosts: 50, unbilled: 100,
        category: 'Filing', vendor: `Vendor ${i}`, fundId: 'fund-1', fund: 'Office fund', refund: 5, netCost: 995,
        inflow: 1000, outflow: 0, staff: `Staff ${i}`, role: i % 2 ? 'partner' : 'associate', actions: 1,
        eligibleBase: 300, earnedFee: value + i, tpa: 15, timeliness: 100, quality: 90, formula: '300 × 15% × 100% × 90%', missing: 0 }));
      const q = url.searchParams.get('q'); if (q) rows = rows.filter(row => [row.reference, row.client, row.staff].some(s => s.toLowerCase().includes(q.toLowerCase())));
      const status = url.searchParams.get('status'); if (status && status !== 'all') rows = rows.filter(row => row.status === status);
      const sort = url.searchParams.get('sort'); if (sort) rows.sort((a, b) => (typeof a[sort] === 'number' ? a[sort] - b[sort] : String(a[sort]).localeCompare(String(b[sort]))) * (url.searchParams.get('dir') === 'asc' ? 1 : -1));
      const size = Number(url.searchParams.get('pageSize') || 10), total = rows.length;
      const page = Math.min(Number(url.searchParams.get('page') || 1), Math.max(1, Math.ceil(total / size)));
      return { section, range: { key: range, from: url.searchParams.get('from') || '2026-01-01', to: url.searchParams.get('to') || '2026-11-16', label: `${range} reporting window` },
        currency: 'RWF', timeZone: 'Africa/Kigali', metrics,
        ageing: [{ key: 'current', label: 'Not yet due', value: 3000, count: 10 }, { key: '1-30', label: '1–30 days overdue', value: 400, count: 2 }, { key: 'unknown', label: 'Due date not recorded', value: 1000, count: 1 }],
        trend: [{ label: '2026-09', billed: 3000, collected: 2600, costs: 50 }, { label: '2026-10', billed: 4000, collected: 3500, costs: 70 }, { label: '2026-11', billed: 3000, collected: 2500, costs: 90 }],
        rows: rows.slice((page - 1) * size, page * size), pagination: { page, pageSize: size, total, pages: Math.max(1, Math.ceil(total / size)) },
        options: { services: [{ id: 'advisory', label: 'Advisory', parent: '', depth: 0 }, { id: 'corporate', label: 'Corporate', parent: 'advisory', depth: 1 }],
          staff: [{ key: 'staff-1', name: 'Staff 1', role: 'associate' }], roles: ['associate', 'partner'], funds: [{ id: 'fund-1', name: 'Office fund' }] },
        notes: ['Entry dates, payment dates and refunds determine period values.', 'Missing payroll and procurement balances remain unavailable.'] };
    };
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()), endpoint = url.pathname;
      requests.push({ endpoint, query: url.search, method: route.request().method() });
      const send = (json, status = 200) => route.fulfill({ status, json }).catch(() => {});
      if (endpoint.includes('/billing/workspace/')) {
        if (slowNext) { slowNext = false; await new Promise(done => setTimeout(done, 16000)); }
        await new Promise(done => setTimeout(done, url.searchParams.get('range') === 'daily' ? 700 : 50));
        if (transientFailures > 0) { transientFailures--; return send({ message: 'Temporary gateway delay' }, 503); }
        if (fail) return send({ message: 'Synthetic finance outage' }, 503);
        return send(response(endpoint.split('/').at(-1), url));
      }
      if (endpoint.endsWith('/terms')) { revision++; return send({ dueDate: '2026-12-01' }); }
      if (endpoint.endsWith('/notifications/count')) return send({ unread: 0 });
      if (endpoint.endsWith('/cases') || endpoint.endsWith('/tasks')) return send([]);
      return send({});
    });
    const sections = { 'financial-dashboard': 'Financial Dashboard', invoicing: 'Billing & Invoicing', collections: 'Collections & Receivables', 'cash-flow': 'Cash & Cash Flow', expenses: 'Expenses & Procurement', remuneration: 'Firm Remuneration' };
    const shots = path.resolve(__dirname, '../build/verification/finance'); fs.mkdirSync(shots, { recursive: true });
    for (const [section, title] of Object.entries(sections)) {
      const start = Date.now(); await page.goto(`${origin}/billing/finance/${section}`);
      await page.getByRole('heading', { name: title, exact: true }).waitFor(); await page.locator('.finance-register table').waitFor();
      timings.push({ section, milliseconds: Date.now() - start });
      assert.equal(await page.locator('.finance-register tbody tr').count(), 10);
      assert(await page.getByLabel('Search finance records').evaluate(el => getComputedStyle(el).fontSize === '14px' && el.getBoundingClientRect().height >= 40), 'Search matches the standard application control size.');
      await page.screenshot({ path: path.join(shots, `${section}-desktop.png`), fullPage: true });
    }
    const navigationTimings = [];
    for (const [section, title] of Object.entries(sections)) {
      const start = Date.now();
      await page.getByRole('link', { name: title, exact: true }).first().click();
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      await page.locator('.finance-register table').waitFor();
      navigationTimings.push({ section, milliseconds: Date.now() - start });
    }
    assert(navigationTimings.every(result => result.milliseconds < 1000), 'Prepared in-app finance navigation should complete below one second.');
    assert.equal(requests.filter(r => r.endpoint.endsWith('/reports/firm')).length, 0, 'Finance pages do not load full firm reports.');
    await page.getByRole('button', { name: 'By staff', exact: true }).click(); await page.locator('th').filter({ hasText: 'Staff member' }).waitFor();
    await page.getByRole('button', { name: 'Remuneration balances', exact: true }).click();
    await page.getByRole('heading', { name: 'Remuneration balances', exact: true }).waitFor();
    assert.equal(await page.getByText('Not recorded', { exact: true }).count(), 4);
    await page.goto(`${origin}/billing/finance/invoicing`); await page.locator('.finance-register table').waitFor();
    await page.getByRole('button', { name: 'Next page', exact: true }).click(); await page.getByText('Page 2 of 2', { exact: true }).waitFor();
    await page.getByLabel('Search finance records').fill('Invoice 01');
    await page.getByText('1 of 1 records', { exact: false }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 1);
    assert(await page.getByLabel('Search finance records').evaluate(el => el === document.activeElement), 'Search keeps focus while new results load.');
    await page.getByLabel('Search finance records').fill(''); await page.getByText('Page 1 of 2', { exact: true }).waitFor();
    await page.getByRole('columnheader', { name: 'Amount' }).getByRole('button').click();
    await page.locator('th[aria-sort="ascending"]').waitFor();
    await page.getByRole('button', { name: 'View Invoice 01', exact: true }).click();
    await page.getByRole('dialog').waitFor(); assert(await page.getByRole('link', { name: 'Open matter billing' }).count());
    await page.getByLabel('Invoice due date').fill('2026-12-01'); await page.getByRole('button', { name: 'Save payment terms', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.locator('.finance-register table').waitFor();
    assert(requests.some(r => r.method === 'PATCH' && r.endpoint.endsWith('/terms')));
    const period = page.getByRole('combobox', { name: 'Reporting period' });
    await period.selectOption('daily'); await page.getByRole('status', { name: 'Loading finance data' }).waitFor();
    assert.equal(await page.locator('.finance-register table').count(), 0, 'Old period records are hidden.');
    await period.selectOption('weekly'); await page.locator('.finance-register table').waitFor();
    await page.waitForTimeout(800);
    assert(cancelled.some(url => url.includes('range=daily')), 'Superseded slow requests are cancelled.');
    await page.getByRole('button', { name: 'View Invoice 01', exact: true }).click(); await page.getByRole('dialog').waitFor();
    assert.match(await page.locator('.finance-record-details').innerText(), /RWF 223/);
    await page.keyboard.press('Escape');
    await period.selectOption('custom'); await page.getByRole('heading', { name: 'Select your reporting dates' }).waitFor();
    await page.getByLabel('From', { exact: true }).fill('2026-11-01'); await page.getByLabel('To', { exact: true }).fill('2026-11-16');
    await page.locator('.finance-register table').waitFor();
    fail = true; await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /Synthetic finance outage/);
    fail = false; await page.getByRole('button', { name: 'Retry', exact: true }).click(); await page.locator('.finance-register table').waitFor();
    const recoveryStart = requests.length;
    transientFailures = 1;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('status', { name: 'Loading finance data' }).waitFor();
    await page.locator('.finance-register table').waitFor();
    assert.equal(requests.slice(recoveryStart).filter(r => r.endpoint.includes('/billing/workspace/')).length, 2, 'Transient failures recover with exactly one automatic retry.');
    const slowStart = requests.length;
    slowNext = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('The server is taking longer than usual. Your request is still running…', { exact: true }).waitFor();
    await page.locator('.finance-register table').waitFor({ timeout: 25000 });
    assert.equal(await page.getByRole('alert').count(), 0, 'A healthy response after the previous 15-second cutoff must not show an error.');
    assert.equal(requests.slice(slowStart).filter(r => r.endpoint.includes('/billing/workspace/')).length, 1, 'A slow in-flight request remains shared until it completes.');
    for (const format of ['Excel', 'PDF']) {
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: format, exact: true }).click();
      const download = await downloadPromise; const file = await download.path(); const bytes = fs.readFileSync(file);
      assert.equal(bytes.subarray(0, format === 'Excel' ? 2 : 4).toString(), format === 'Excel' ? 'PK' : '%PDF');
    }
    assert(requests.some(r => r.query.includes('pageSize=100')), 'Exports load all matching rows, not only the visible page.');
    await page.goto(`${origin}/billing/finance/cash-flow?tab=forecast`); await page.getByRole('heading', { name: 'Next 30 days · scenario', exact: true }).waitFor();
    await page.getByLabel('Planned cash payments', { exact: true }).fill('200');
    assert.match(await page.locator('.finance-forecast').innerText(), /RWF 3,100/);
    await page.goto(`${origin}/billing/finance/expenses?tab=vendors`); await page.getByRole('heading', { name: 'Vendor spend register' }).waitFor();
    await page.goto(`${origin}/billing/finance/financial-dashboard`); await page.locator('.finance-register table').waitFor();
    await page.getByLabel('Legal service', { exact: true }).selectOption('advisory'); await page.getByLabel('Category', { exact: true }).waitFor();
    assert(new URL(page.url()).searchParams.get('servicePath') === 'advisory');
    for (const [section, title] of Object.entries(sections)) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/billing/finance/${section}`); await page.getByRole('heading', { name: title, exact: true }).waitFor(); await page.locator('.finance-register table').waitFor();
      await page.screenshot({ path: path.join(shots, `${section}-mobile.png`), fullPage: true });
      if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) {
        console.log(await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && !el.closest('.finance-table-scroll')).slice(0, 20).map(el => ({ tag: el.tagName, class: el.className, position: getComputedStyle(el).position, overflow: getComputedStyle(el).overflowX, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })) })));
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${section} must not overflow the mobile page.`);
    }
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: path.join(shots, 'remuneration-dark-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []); console.log('Full browser navigations (includes initial application startup):'); console.table(timings);
    console.log('In-app finance navigation:'); console.table(navigationTimings);
    console.log('PASS: all six pages; filters, focus, sorting, pagination, details, terms, date races, retry, exports, forecast, mobile and dark mode.');
    console.log(`Screenshots: ${shots}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(done => server.close(done));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
