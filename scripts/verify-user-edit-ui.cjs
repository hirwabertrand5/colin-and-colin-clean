/** Account/TPA regression checks using local browser fixtures; no live user changes. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const express = require('../colin-backend/node_modules/express');
const { chromium } = require('../colin-backend/node_modules/playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const app = express();
  app.use(express.static(path.join(root, 'build')));
  app.use((_req, res) => res.sendFile(path.join(root, 'build/index.html')));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    console.log('Starting local account/TPA browser verification…');
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('user', JSON.stringify({ id: '111111111111111111111111', name: 'Fixture Director', role: 'managing_director', email: 'director@test.invalid' }));
      localStorage.setItem('token', 'fixture-token');
      window.__userRequests = [];
      window.__rejectEdit = false;
      window.__holdEdit = false;
      const users = [{ _id: '222222222222222222222222', name: 'Fixture Associate', email: 'associate@test.invalid', role: 'associate', isActive: true }];
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, options = {}) => {
        const url = String(input);
        if (!url.includes('/api/')) return nativeFetch(input, options);
        const endpoint = new URL(url, location.origin).pathname;
        const method = options.method || 'GET';
        const body = options.body ? JSON.parse(options.body) : undefined;
        window.__userRequests.push({ endpoint, method, body });
        const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
        if (endpoint.endsWith('/tpa')) {
          if (method === 'POST') return reply({ affectedActivities: 0, preservedSnapshots: 0, savedEarningsAffected: 0, unpricedActivities: 0, financialImpact: {}, message: 'Fixture preview' });
          return reply({ history: [], revision: 0, currentRate: 20, defaultRate: 20, timeZone: 'Africa/Kigali', serverNow: new Date().toISOString() });
        }
        if (endpoint === '/api/users' && method === 'GET') return reply(users);
        if (endpoint === '/api/users/222222222222222222222222' && method === 'PUT') {
          if (window.__holdEdit) await new Promise(resolve => { window.__releaseEdit = resolve; });
          if (window.__rejectEdit) return reply({ message: 'That email address is already registered.' }, 400);
          Object.assign(users[0], body, { name: body.name.trim() });
          return reply(users[0]);
        }
        if (endpoint.endsWith('/notifications/unread-count')) return reply({ unread: 0 });
        return reply([]);
      };
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/admin/users`);
    const editButton = () => page.getByRole('button', { name: 'Edit', exact: true });
    await editButton().click();
    let dialog = page.getByRole('dialog', { name: 'Edit User', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.locator('input').count(), 2);
    assert.equal(await dialog.locator('select').count(), 1);
    assert.equal(await dialog.locator('.tpa-management').count(), 0);
    assert.equal(await page.evaluate(() => window.__userRequests.filter(item => item.endpoint.endsWith('/tpa')).length), 0);
    assert.equal(await dialog.getByLabel('Full Name', { exact: false }).inputValue(), 'Fixture Associate');
    await dialog.getByLabel('Full Name', { exact: false }).fill('  Updated Associate  ');
    await dialog.getByLabel('Email Address', { exact: false }).fill('updated@test.invalid');
    await dialog.getByLabel('Role', { exact: false }).selectOption('senior_associate');
    await page.evaluate(() => { window.__holdEdit = true; });
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.waitForFunction(() => typeof window.__releaseEdit === 'function');
    assert(await dialog.getByRole('button', { name: 'Saving…', exact: true }).isDisabled());
    assert(await dialog.getByRole('button', { name: 'Cancel', exact: true }).isDisabled());
    await page.keyboard.press('Escape');
    assert(await dialog.isVisible());
    await page.evaluate(() => { window.__holdEdit = false; window.__releaseEdit(); });
    await dialog.waitFor({ state: 'detached' });
    const updates = await page.evaluate(() => window.__userRequests.filter(item => item.method === 'PUT'));
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].body, { name: '  Updated Associate  ', email: 'updated@test.invalid', role: 'senior_associate' });
    await page.getByRole('table').getByText('Updated Associate', { exact: true }).waitFor();
    console.log('PASS: Edit User contains only account fields, saves once and uses the server response');

    await editButton().click();
    dialog = page.getByRole('dialog', { name: 'Edit User', exact: true });
    await page.evaluate(() => { window.__rejectEdit = true; });
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await dialog.getByRole('alert').getByText('That email address is already registered.', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert(await editButton().evaluate(element => element === document.activeElement));
    await page.evaluate(() => { window.__rejectEdit = false; });
    console.log('PASS: Failed saves stay in the account form; Escape closes and restores focus');

    await page.getByLabel('Manage staff TPA', { exact: true }).selectOption('222222222222222222222222');
    const tpa = page.getByRole('dialog', { name: 'TPA Management', exact: true });
    await tpa.getByRole('heading', { name: 'Current allocation' }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1);
    assert.equal(await tpa.locator('form').count(), 0);
    assert.equal(await tpa.getByRole('button', { name: 'Save Changes' }).count(), 0);
    await tpa.getByLabel('Reason', { exact: false }).fill('Fixture allocation review');
    await tpa.getByRole('button', { name: 'Review TPA Change', exact: true }).click();
    await tpa.getByRole('button', { name: 'Confirm Change', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__userRequests.filter(item => item.method === 'PUT').length), 2);
    assert.equal(await page.evaluate(() => window.__userRequests.filter(item => item.endpoint.endsWith('/tpa') && item.method === 'POST').length), 1);
    await tpa.getByRole('button', { name: 'Close TPA management', exact: true }).click();
    await tpa.waitFor({ state: 'detached' });
    console.log('PASS: Manage Staff TPA opens independently and its review button never submits user details');

    const output = path.join(root, 'node_modules/.cache/user-edit-ui');
    fs.mkdirSync(output, { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 844 });
        if (width < 1024) await page.waitForFunction(() => document.querySelector('.app-shell-sidebar').getBoundingClientRect().right <= 1);
        await editButton().click();
        dialog = page.getByRole('dialog', { name: 'Edit User', exact: true });
        await dialog.waitFor();
        const bounds = await dialog.boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `Dialog overflows at ${width}`);
        assert(bounds.y >= 0 && bounds.y + bounds.height <= 845, `Dialog exceeds viewport height at ${width}`);
        assert.equal(await page.getByRole('dialog').count(), 1);
        assert.equal(await dialog.locator('.tpa-management').count(), 0);
        await page.screenshot({ path: path.join(output, `edit-${theme}-${width}.png`), animations: 'disabled' });
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS: Compact account dialog fits mobile and desktop in light and dark modes');
    console.log('User edit verification complete: 4 groups passed; all API calls used fixtures.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
