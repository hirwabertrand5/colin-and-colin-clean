/** Local UI checks with synthetic API fixtures. No deployed API or real recipients. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const express = require('../colin-backend/node_modules/express');
const { chromium } = require('../colin-backend/node_modules/playwright');

async function main() {
  const app = express();
  const root = path.resolve(__dirname, '..');
  app.use(express.static(path.join(root, 'build')));
  app.use((_req, res) => res.sendFile(path.join(root, 'build/index.html')));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('user', JSON.stringify({ id: '111111111111111111111111', name: 'Verification Director', email: 'director@test.invalid', role: 'managing_director' }));
      localStorage.setItem('token', 'synthetic-local-token');
      window.__savedPrefs = [];
      let prefs = { emailEnabled: true, deadlinesEnabled: true, taskAssignmentsEnabled: true, approvalsEnabled: true, pettyCashLowEnabled: true, taskDueReminderHours: 24, eventReminderHours: [24, 2], mattersEnabled: true, pettyCashCreatedEnabled: true, pettyCashExpensesEnabled: true, pettyCashExpenseMode: 'daily', overdueEscalationHours: 24 };
      const original = window.fetch.bind(window);
      window.fetch = async (input, options = {}) => {
        const url = String(input);
        if (!url.includes('/api/')) return original(input, options);
        const reply = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.includes('/notifications/preferences/me')) {
          if (options.method === 'PUT') { prefs = { ...prefs, ...JSON.parse(options.body) }; window.__savedPrefs.push(prefs); }
          return reply(prefs);
        }
        if (url.includes('/notifications/unread-count')) return reply({ unread: 1 });
        if (url.includes('/notifications')) return reply([{ _id: '222222222222222222222222', type: 'CASE_MANAGEMENT_REVIEW_REQUESTED', title: 'Review requested', message: 'Synthetic work is ready for review.', severity: 'warning', createdAt: new Date().toISOString(), isReadBy: [], audienceUserIds: ['111111111111111111111111'], link: '/cases/test' }]);
        if (url.includes('/admin/email/status')) return reply({ configuration: { configured: false, message: 'Replace the placeholder sending key.' }, enabled: false, webhookConfigured: false, queueErrors: 0, counts: [{ _id: 'failed', count: 1 }], recent: [{ _id: 'delivery-1', to: 'safe-recipient@test.invalid', subject: 'Verification notification', status: 'failed', attempts: 1, lastCode: 'EMAIL_NOT_CONFIGURED', lastError: 'Sender requires configuration.' }] });
        if (url.includes('/intake-automation/config')) return reply({});
        return reply([]);
      };
    });
    await page.goto(`${base}/notifications`);
    await page.getByRole('heading', { name: 'Notification Preferences' }).waitFor();
    await page.getByRole('button', { name: 'Returned Work', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retainer Renewals', exact: true }).waitFor();
    await page.getByLabel('Petty cash expense emails').selectOption('immediate');
    await page.getByLabel('Escalate critical overdue work after (hours)').fill('12');
    await page.getByRole('button', { name: 'Save Preferences', exact: true }).click();
    await page.waitForFunction(() => window.__savedPrefs.length === 1);
    const saved = await page.evaluate(() => window.__savedPrefs[0]);
    assert.equal(saved.pettyCashExpenseMode, 'immediate'); assert.equal(saved.overdueEscalationHours, 12);
    console.log('PASS: Notification Center filters and editable email preferences');
    const output = path.join(root, 'node_modules/.cache/notification-ui'); fs.mkdirSync(output, { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      if (theme === 'dark') await page.waitForFunction(() => {
        const color = getComputedStyle(document.querySelector('.notification-unread')).backgroundColor.match(/\d+/g).map(Number);
        return color.slice(0, 3).every(channel => channel < 128);
      });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        if (width < 1024) await page.waitForFunction(() => document.querySelector('.app-shell-sidebar').getBoundingClientRect().right <= 1);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Notification layout overflow: ${theme} ${width}`);
        await page.screenshot({ path: path.join(output, `notifications-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
      }
    }
    console.log('PASS: Notification Center desktop/mobile layout in light and dark themes');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/admin/settings`);
    await page.getByText('Email delivery', { exact: true }).waitFor();
    await page.getByText('Sender requires configuration.', { exact: true }).waitFor();
    assert.equal(await page.getByText('SMTP credentials are read from backend environment variables.').count(), 0);
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await page.getByText('Sender requires configuration.', { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('.app-shell-sidebar').getBoundingClientRect().right <= 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Settings layout overflow');
    await page.screenshot({ path: path.join(output, 'delivery-status-mobile.png'), fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log('PASS: Managing Director delivery status, visible failures and responsive settings');
    console.log('Notification UI verification complete: 3 groups passed. All API calls used local fixtures.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
