/** Real password verification and browser sign-in, disposable DB, no .env or external traffic. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('../colin-backend/node_modules/express');
const cors = require('../colin-backend/node_modules/cors');
const mongoose = require('../colin-backend/node_modules/mongoose');
const { MongoMemoryServer } = require('../colin-backend/node_modules/mongodb-memory-server');
const { chromium } = require('../colin-backend/node_modules/playwright');
const root = path.resolve(__dirname, '..');
async function main() {
  delete process.env.MONGO_URI; delete process.env.RESEND_API_KEY;
  process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'isolated-sign-in-verification';
  const baseline = process.argv.includes('--baseline');
  const mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14', systemBinary: path.join(root, 'colin-backend/node_modules/.cache/mongodb-memory-server/test-mongod.exe') }, instance: { launchTimeout: 120000 } });
  let apiServer, frontendServer, browser;
  try {
    await mongoose.connect(mongo.getUri(), { dbName: 'sign_in_verification' });
    const { login } = require('../colin-backend/dist/controllers/authController');
    const User = require('../colin-backend/dist/models/userModel').default;
    await User.init();
    const password = 'Synthetic-login+verification&42=secure!';
    const users = await User.create(['associate', 'managing_partner', 'executive_assistant'].map(role => ({ name: 'Synthetic ' + role, role, email: role + '@test.invalid', passwordHash: password })));
    const hashes = users.map(user => user.passwordHash);
    const front = express();
    front.use((_req, res, next) => { res.set('Content-Security-Policy', "connect-src 'self' http://127.0.0.1:*; img-src 'self' data:; font-src 'self' data:"); next(); });
    front.use(express.static(path.join(root, 'build'))); front.use((_req, res) => res.sendFile(path.join(root, 'build/index.html')));
    frontendServer = front.listen(0, '127.0.0.1'); await once(frontendServer, 'listening');
    const frontendBase = `http://127.0.0.1:${frontendServer.address().port}`;
    let preflights = 0, authContentType = '';
    const api = express();
    api.use((req, _res, next) => { if (req.method === 'OPTIONS' && req.path === '/api/auth/login') { preflights++; return setTimeout(next, 120); } next(); });
    api.use(cors({ origin: frontendBase })); api.use(express.json()); api.use(express.urlencoded({ extended: true }));
    api.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
    api.post('/api/auth/login', (req, res) => { authContentType = req.headers['content-type']; return login(req, res); });
    api.get('/api/dashboard/bootstrap', (_req, res) => {
      res.type('application/x-ndjson');
      setTimeout(() => res.end(['cases', 'tasks', 'events', 'audit', 'prospects', 'invoices', 'staff', 'independent'].map(section => JSON.stringify({ section, status: 'fulfilled', value: [] })).join('\n') + '\n'), 2500);
    });
    api.get('/api/notifications/unread-count', (_req, res) => res.json({ count: 0 }));
    api.use((_req, res) => res.json([]));
    apiServer = api.listen(0, '127.0.0.1'); await once(apiServer, 'listening');
    const apiBase = `http://127.0.0.1:${apiServer.address().port}`;
    const durations = [];
    for (let index = 0; index < 5; index++) {
      const start = performance.now();
      const response = await fetch(apiBase + '/api/auth/login', { method: 'POST', body: new URLSearchParams({ email: '  ASSOCIATE@test.invalid  ', password }) });
      assert.equal(response.status, 200); const data = await response.json(); assert(data.token); assert.equal(data.user.role, 'associate');
      durations.push(performance.now() - start);
    }
    const bad = await fetch(apiBase + '/api/auth/login', { method: 'POST', body: new URLSearchParams({ email: users[0].email, password: 'wrong' }) }); assert.equal(bad.status, 401);
    await User.updateOne({ _id: users[0]._id }, { isActive: false });
    const inactive = await fetch(apiBase + '/api/auth/login', { method: 'POST', body: new URLSearchParams({ email: users[0].email, password }) }); assert.equal(inactive.status, 401);
    await User.updateOne({ _id: users[0]._id }, { isActive: true });
    const after = await User.find({ _id: { $in: users.map(user => user._id) } });
    for (const user of after) assert.equal(user.passwordHash, hashes[users.findIndex(item => String(item._id) === String(user._id))]);
    console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'updated', firstAuthMs: Math.round(durations[0]), subsequentAuthMs: durations.slice(1).map(value => Math.round(value)), passwordAndInactiveChecks: 'passed', originalHashesPreserved: true }));
    browser = await chromium.launch({ executablePath: process.env.INTAKE_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    const results = [];
    for (const user of users) {
      const context = await browser.newContext();
      // CSP blocks external traffic without browser request interception, which can
      // bypass native CORS preflights and invalidate the sign-in measurement.
      await context.addInitScript(({ apiBase }) => {
        const native = window.fetch.bind(window);
        window.fetch = (input, init) => { const url = new URL(String(input), location.href); return native(url.pathname.startsWith('/api/') ? apiBase + url.pathname + url.search : input, init); };
      }, { apiBase });
      const page = await context.newPage();
      await page.goto(frontendBase + '/login'); await page.locator('#email').fill(user.email); await page.locator('#password').fill(password);
      await page.waitForLoadState('networkidle');
      const before = preflights;
      const auth = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
      const started = performance.now();
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      const authenticated = await auth; assert.equal(authenticated.status(), 200);
      const authMs = performance.now() - started;
      await page.getByText('Sign Out', { exact: true }).first().waitFor();
      const shellMs = performance.now() - started;
      const result = { role: user.role, clickToAuthMs: Math.round(authMs), clickToWorkspaceMs: Math.round(shellMs), loginPreflights: preflights - before, contentType: authContentType };
      if (!baseline) { assert.equal(result.loginPreflights, 0); assert.match(result.contentType, /^application\/x-www-form-urlencoded/); assert(shellMs < 1000, `${user.role} sign-in exceeded 1s: ${Math.round(shellMs)}ms`); }
      results.push(result); await context.close();
    }
    const directory = path.join(root, 'node_modules/.cache/sign-in'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, baseline ? 'baseline.json' : 'updated.json'), JSON.stringify({ firstAuthMs: durations[0], subsequentAuthMs: durations.slice(1), results }, null, 2));
    console.log(JSON.stringify({ results }));
    console.log('PASS: real credential checks, user roles, preserved password hashes and browser sign-in while dashboard data takes 2.5 seconds.');
  } finally {
    if (browser) await browser.close();
    for (const server of [apiServer, frontendServer]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await mongoose.disconnect(); await mongo.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
