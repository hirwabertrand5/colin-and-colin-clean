/** Production bundle, synthetic API responses, local browser only. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const express = require('../colin-backend/node_modules/express');
const { chromium } = require('../colin-backend/node_modules/playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const web = express(); web.use(express.static(path.join(root, 'build')));
  web.use((_req, res) => res.sendFile(path.join(root, 'build/index.html')));
  const server = web.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], requests = [];
    let fail = false, revision = 0;
    const actor = { id: '111111111111111111111111', name: 'Fixture Manager', role: 'managing_partner', email: 'fixture@ui.invalid' };
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(actor => { localStorage.setItem('token', 'fixture-token'); localStorage.setItem('user', JSON.stringify(actor)); }, actor);
    const intercept = async route => {
      const url = new URL(route.request().url()), endpoint = url.pathname;
      const period = url.searchParams.get('range'); requests.push({ endpoint, query: url.search });
      const value = ({ daily: 111, weekly: 222, monthly: 333, quarterly: 444, yearly: 555, ytd: 666, custom: 777, all: 888 })[period] + revision;
      const send = (json, status = 200) => route.fulfill({ status, json }).catch(() => {});
      if (endpoint.endsWith('/reports/firm')) {
        await new Promise(done => setTimeout(done, period === 'daily' ? 900 : 50));
        if (fail) return send({ message: 'Synthetic reporting failure' }, 503);
        return send({ range: { from: url.searchParams.get('from') || '2026-11-01', to: url.searchParams.get('to') || '2026-11-13' }, team: Array.from({ length: 13 }, (_, i) => ({
          id: `staff-${i}`, name: `Staff ${String(i + 1).padStart(2, '0')}`, role: i % 2 ? 'partner' : 'associate',
          activeCases: i + 1, tasksCompleted: i, earlyTasks: 1, onTimeTasks: 2, lateTasks: 0, overdueTasks: i % 3,
          revenueAttributed: value + i, grossFeesHandled: 1000 + i, firmRetainedEarnings: 1000 - value,
        })) });
      }
      if (endpoint.endsWith('/reports/profitability')) {
        const row = { id: 'matter-1', matterNo: 'MAT-2026-01', client: 'Fixture client', label: 'Fixture client', practiceArea: 'Advisory', matterCount: 1,
          activeMatters: 1, contractValue: 10000, billed: 5000, collected: value, outstanding: 200, directMatterCosts: 100, grossContribution: value - 100, contributionMargin: 75 };
        return send({ range: { from: '2026-11-01', to: '2026-11-13', label: `${period} reporting window` }, currency: 'RWF', timeZone: 'Africa/Kigali',
          firm: { activeMatters: 1, contractValue: 10000, billed: 5000, recognisedCollectedRevenue: value, totalReceivables: 200, directMatterCosts: 100, generalOverheads: 50,
            totalFirmCosts: 150, grossContribution: value - 100, grossMargin: 75, netProfit: value - 150, netProfitMargin: 70, costRatio: 30, collectionRate: 50 },
          ageing: { current: 200, days31to60: 0, days61to90: 0, over90: 0 }, matterRows: [row], clientRows: [row], practiceAreaRows: [row] });
      }
      if (endpoint.endsWith('/auth/login')) {
        await new Promise(done => setTimeout(done, 120));
        return send({ token: 'signed-in-fixture', user: actor });
      }
      if (endpoint.endsWith('/notifications/count')) return send({ unread: 0 });
      if (endpoint.endsWith('/health')) return send({ status: 'ok' });
      if (endpoint.endsWith('/cases') || endpoint.endsWith('/tasks')) return send([]);
      return send({});
    };
    await page.route('**/api/**', intercept);
    await page.goto(`${origin}/billing/finance/profitability/staff-profitability`);
    await page.getByRole('heading', { name: 'Staff profitability', exact: true }).waitFor();
    await page.getByRole('table').waitFor();
    assert(requests.some(r => r.endpoint.endsWith('/reports/firm') && r.query.includes('scope=profitability')));
    assert(!requests.some(r => r.endpoint.endsWith('/reports/profitability')), 'Staff tab must not fetch unrelated financial/retainer data');
    assert.equal(await page.locator('.profitability-staff-summary .profitability-metric').count(), 4);
    const period = page.getByRole('combobox', { name: 'Reporting period' });
    assert.deepEqual(await period.locator('option').allTextContents(), ['Today', 'Last 7 Days', 'This Month', 'Last Quarter', 'Last Year', 'Year to Date', 'Custom Range']);
    await period.selectOption('daily');
    await page.getByText('Loading selected period…', { exact: true }).waitFor();
    assert.equal(await page.getByRole('table').count(), 0, 'Old-period figures are hidden while loading');
    await period.selectOption('weekly');
    await page.getByRole('table').waitFor();
    assert.match(await page.locator('tbody').innerText(), /RWF 234/);
    await page.waitForTimeout(1000);
    assert.match(await page.locator('tbody').innerText(), /RWF 234/, 'Slow earlier response must not overwrite the latest period');
    await page.getByLabel('Search staff').fill('Staff 01');
    assert.equal(await page.locator('tbody tr').count(), 1);
    await page.getByLabel('Search staff').fill('');
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    assert.match(await page.locator('.profitability-pagination').innerText(), /Page 2 of 2/);
    await period.selectOption('monthly'); await page.getByRole('table').waitFor();
    assert.match(await page.locator('.profitability-pagination').innerText(), /Page 1 of 2/, 'Period change resets pagination');
    await period.selectOption('custom');
    assert.equal(await page.getByRole('table').count(), 0);
    await page.getByLabel('From', { exact: true }).fill('2026-11-13');
    await page.getByLabel('To', { exact: true }).fill('2026-11-12');
    await page.getByText('The From date must be on or before the To date.', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('table').count(), 0);
    await page.getByLabel('To', { exact: true }).fill('2026-11-14');
    await page.getByRole('table').waitFor();
    assert(requests.some(r => r.query.includes('from=2026-11-13') && r.query.includes('to=2026-11-14')));
    await period.selectOption('yearly'); await page.getByRole('table').waitFor();
    assert(requests.some(r => r.query.includes('range=yearly')));
    fail = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Synthetic reporting failure' }).waitFor();
    assert.equal(await page.getByRole('table').count(), 0);
    fail = false; revision = 10;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('table').waitFor();
    assert.match(await page.locator('tbody').innerText(), /RWF 577/);
    console.log('PASS: Firm Reports period options, requested API scope, rapid switches, stale response exclusion, custom dates, pagination, search, refresh and error recovery');

    const shots = path.join(root, 'build', 'verification'); fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'staff-profitability-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Firm overview', exact: true }).click();
    await page.getByText('Net profit in period', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(shots, 'profitability-overview.png'), fullPage: true });
    await page.getByRole('button', { name: 'Matter', exact: true }).click();
    await page.getByRole('heading', { name: 'Matter profitability', exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile page must not overflow horizontally');
    await page.getByRole('button', { name: 'Staff profitability', exact: true }).click();
    await page.getByRole('table').waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(shots, 'staff-profitability-mobile.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: path.join(shots, 'staff-profitability-dark.png'), fullPage: true });
    console.log('PASS: financial tabs, desktop/mobile contained tables and dark-mode rendering');

    const loginPage = await browser.newPage();
    loginPage.on('pageerror', e => errors.push(e.message));
    await loginPage.route('**/api/**', intercept);
    await loginPage.goto(`${origin}/login`);
    await loginPage.getByLabel('Email Address').fill(actor.email);
    await loginPage.getByLabel('Password', { exact: true }).fill('test-only');
    assert(requests.some(r => r.endpoint.endsWith('/health')), 'Login warms the backend while credentials are entered');
    const started = Date.now();
    await loginPage.getByRole('button', { name: 'Sign In', exact: true }).click();
    await loginPage.waitForURL(`${origin}/`);
    const loginMs = Date.now() - started;
    await loginPage.getByText('Fixture Manager', { exact: true }).first().waitFor();
    console.log(`PASS: sign-in navigation ${loginMs} ms with a synthetic 120 ms API response`);
    assert.deepEqual(errors, [], 'No frontend runtime errors');
    console.log(`Screenshots: ${shots}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(done => server.close(done));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
