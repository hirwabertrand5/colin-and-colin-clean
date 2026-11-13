/** Browser regression for the 105/107 mismatch using synthetic local records. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const express = require('../colin-backend/node_modules/express');
const { chromium } = require('../colin-backend/node_modules/playwright');

async function main() {
  const app = express(); app.use(express.static(path.resolve(__dirname, '../build')));
  app.use((_req, res) => res.sendFile(path.resolve(__dirname, '../build/index.html')));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const actor = { id: 'ui-manager', name: 'Fixture Manager', email: 'manager@count.invalid', role: 'managing_director' };
  const base = i => ({ _id: `matter-${i}`, caseNo: `MAT-${i}`, parties: 'Count Client', status: 'In Progress', assignedTo: actor.name,
    caseType: 'Transactional Cases', budget: '1000', legalServicePath: [{ label: 'Advisory' }], caseAssignments: { initiator: actor.name },
    createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', workflowProgress: { status: 'In Progress', percent: 0 } });
  const cases = [...Array.from({ length: 105 }, (_, i) => base(i)),
    { ...base(105), workflowProgress: { status: 'Completed' } }, { ...base(106), status: 'Returned to Intake' },
    { ...base(107), status: 'Temporarily Closed' }, { ...base(108), status: 'Closed' }, { ...base(109), status: 'Cancelled' }];
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(actor => { localStorage.setItem('user', JSON.stringify(actor)); localStorage.setItem('token', 'count-fixture'); }, actor);
    await page.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname;
      const send = data => route.fulfill({ json: data });
      if (endpoint.endsWith('/dashboard/bootstrap')) {
        const sections = { cases, tasks: [], events: [], audit: [], prospects: [], invoices: [], fund: null, staff: [],
          billing: { billed: 0, collected: 0, outstanding: 0, collectionRate: 0, months: [] } };
        return route.fulfill({ contentType: 'application/x-ndjson', body: Object.entries(sections).map(([section, value]) => JSON.stringify({ section, status: 'fulfilled', value })).join('\n') + '\n' });
      }
      if (endpoint.endsWith('/cases')) return send(cases);
      if (endpoint.endsWith('/reports/firm')) return send({ range: { from: '2026-01-01', to: '2026-11-13' }, kpis: { activeCases: 105 }, team: [], clientProfitability: [], months: [], caseTypes: [], ageingReport: [] });
      if (endpoint.endsWith('/users/staff')) return send([{ _id: actor.id, name: actor.name, email: actor.email, role: actor.role, isActive: true }]);
      return send(endpoint.includes('unread') ? { count: 0 } : []);
    });
    await page.goto(origin);
    const card = page.locator('.mp-metric-card').filter({ has: page.getByText('Active Matters', { exact: true }) });
    await card.getByText('105', { exact: true }).waitFor();
    await page.goto(`${origin}/matters`);
    await page.getByText(/Showing 1.*10 of 105/).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 10, 'Pagination must use the same full active population');
    await page.goto(`${origin}/matters/temporarily-closed`);
    await page.getByText(/Showing 1.*1 of 1/).waitFor();
    await page.goto(`${origin}/matters/closed`);
    await page.getByText(/Showing 1.*2 of 2/).waitFor();
    await page.goto(`${origin}/management/clients-business-development?view=client-0`);
    await page.getByText('105', { exact: true }).first().waitFor();
    await page.goto(`${origin}/management/people/capacity`);
    await page.getByRole('table').waitFor();
    await page.getByText('105', { exact: true }).first().waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: dashboard and Active Matters both show 105; temporary and completed lists stay separate; client and People & Capacity counters agree');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
