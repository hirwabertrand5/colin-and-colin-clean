// Browser checks use the production bundle and intercepted test responses only.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { once } = require('node:events');
const { chromium } = require('../../colin-backend/node_modules/playwright');

async function main() {
  const app = express();
  const root = path.resolve(__dirname, '../../build');
  app.use(express.static(root)); app.use((req, res) => res.sendFile(path.join(root, 'index.html')));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    const cache = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright');
    const cached = cache && fs.existsSync(cache) ? fs.readdirSync(cache).filter(name => /^chromium-\d+$/.test(name))
      .map(name => path.join(cache, name, 'chrome-win64', 'chrome.exe')).find(file => fs.existsSync(file)) : undefined;
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (fs.existsSync(chromium.executablePath()) ? chromium.executablePath() : cached);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ timezoneId: 'America/Los_Angeles', viewport: { width: 1280, height: 900 } });
    await context.addInitScript(() => {
      localStorage.setItem('token', 'isolated-browser-test');
      localStorage.setItem('user', JSON.stringify({ id: 'partner', name: 'Managing Partner', role: 'managing_partner', email: 'partner@ui.invalid' }));
    });
    const page = await context.newPage();
    const screenshots = process.env.TPA_SCREENSHOT_DIR || path.join(require('node:os').tmpdir(), 'tpa-ui-review');
    fs.mkdirSync(screenshots, { recursive: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let now = Date.now();
    const config = { history: [], revision: 0, currentRate: 2.75, defaultRate: 2.75, timeZone: 'Africa/Kigali', serverNow: new Date(now).toISOString() };
    let reviewed;
    let saves = 0;
    await page.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (request.isNavigationRequest() && url.origin === origin) return route.continue();
      if (url.pathname.endsWith('/users/staff/tpa')) {
        if (request.method() === 'GET') return route.fulfill({ json: { ...config, serverNow: new Date(now).toISOString() } });
        const body = request.postDataJSON();
        if (body.preview) { reviewed = body; return route.fulfill({ json: { affectedActivities: 3, preservedSnapshots: 1, savedEarningsAffected: 0,
          unsnapshottedActivities: 2, unpricedActivities: 1, financialImpact: { RWF: { proposedDelta: 4321, appliedDelta: 3210 } }, message: 'Dynamic impact preview' } }); }
        saves++; config.revision++;
        config.history.push({ _id: `rate-${saves}`, kind: body.kind, rate: body.rate, from: body.from, until: body.until });
        return route.fulfill({ json: { message: 'Saved' } });
      }
      if (url.pathname.endsWith('/users')) return route.fulfill({ json: [{ _id: 'staff', name: 'Dynamic Staff', email: 'staff@ui.invalid', role: 'associate', isActive: true }] });
      if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
      return route.fulfill({ json: [] });
    });
    await page.goto(`${origin}/admin/users`);
    await page.getByRole('combobox', { name: 'Manage staff TPA' }).selectOption('staff');
    const dialog = page.getByRole('dialog', { name: 'TPA Management' });
    await dialog.waitFor();
    assert(await dialog.evaluate(el => el.classList.contains('retainer-form')));
    const section = page.getByRole('region', { name: 'TPA and earnings configuration' });
    await section.getByRole('radio', { name: 'Normal TPA', exact: true }).waitFor();
    assert.match(await section.innerText(), /2.75%/);
    assert.match(await section.innerText(), /Legacy allocation/);
    await page.screenshot({ path: path.join(screenshots, 'tpa-desktop.png') });
    const local = new Date(now + 48 * 3600000 + 2 * 3600000).toISOString().slice(0,16);
    await section.getByLabel('Rate (%)').fill('7.25');
    await section.getByLabel('Starts from — date and time').fill(local);
    await section.getByLabel('Reason').fill('Selected dynamic effective date');
    await section.getByRole('button', { name: 'Review TPA Change' }).click();
    await section.getByRole('alertdialog').waitFor();
    assert.equal(reviewed.from, new Date(`${local}+02:00`).toISOString());
    assert.equal(reviewed.rate, 7.25);
    assert.match(await section.getByRole('alertdialog').innerText(), /affected activities\s*3/);
    assert.match(await section.getByRole('alertdialog').innerText(), /4,321/);
    await section.getByRole('button', { name: 'Confirm Change' }).click();
    await section.getByRole('status').waitFor();
    assert.equal(saves, 1);
    assert.match(await section.locator('tbody').innerText(), /7.25%/);
    assert.match(await section.locator('tbody').innerText(), /Scheduled/);
    console.log('PASS: selected start date is sent as the correct instant despite a different browser timezone; stored rate and status are dynamic');

    await section.getByRole('radio', { name: 'Normal TPA', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await section.getByRole('radio', { name: 'Special TPA', exact: true }).getAttribute('aria-checked'), 'true');
    await section.getByLabel('Rate (%)').fill('12.5');
    await section.getByLabel('End condition').selectOption('fixed');
    await section.getByLabel('Effective until').fill(new Date(now + 72 * 3600000 + 2 * 3600000).toISOString().slice(0,16));
    await section.getByLabel('Reason').fill('Schedule a temporary adjustment');
    await section.getByRole('button', { name: 'Review TPA Change' }).click();
    await section.getByRole('alertdialog').waitFor();
    assert.equal(reviewed.kind, 'special'); assert.equal(reviewed.rate, 12.5); assert(reviewed.until > reviewed.from);
    await section.getByRole('button', { name: 'Back to editing', exact: true }).click();
    assert.equal(saves, 1);
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await section.evaluate(el => el.getBoundingClientRect().right > window.innerWidth);
    assert.equal(overflow, false);
    assert.equal(await section.locator('.retainer-model-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
    await section.getByLabel('Rate type').selectOption('special');
    await section.getByText('No matching rate records', { exact: true }).waitFor();
    await section.getByLabel('Rate type').selectOption('all');
    assert.match(await section.locator('tbody').innerText(), /7.25%/);
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(23, 32, 51)');
    await section.getByRole('radio', { name: 'Stop special TPA' }).click();
    await section.getByText('No active or scheduled special rates', { exact: true }).waitFor();
    assert(await section.getByRole('button', { name: 'Review TPA Change' }).isDisabled());
    await dialog.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: path.join(screenshots, 'tpa-mobile-dark.png') });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/matters/retainers`);
    await page.getByRole('button', { name: 'New retainer' }).click();
    const retainer = page.getByRole('dialog', { name: 'Create a retainer' });
    await retainer.waitFor();
    await retainer.getByRole('radio', { name: 'Monthly service agreement', exact: true }).click();
    await retainer.getByLabel('Monthly service fee').waitFor();
    assert.equal(await retainer.getByRole('radio', { name: 'Monthly service agreement', exact: true }).getAttribute('aria-checked'), 'true');
    await retainer.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log('PASS: retainer dialog layout, special scheduling, edit cancellation, history filters, mobile stacking, dark mode and keyboard dismissal');
    console.log('PASS: shared form components preserve New Retainer billing-model selection and conditional fields');
  } finally {
    if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
