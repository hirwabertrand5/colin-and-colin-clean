/** Full browser -> existing API -> disposable MongoDB -> staff review. Never loads .env. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const express = require('../colin-backend/node_modules/express');
const mongoose = require('../colin-backend/node_modules/mongoose');
const jwt = require('../colin-backend/node_modules/jsonwebtoken');
const { MongoMemoryReplSet } = require('../colin-backend/node_modules/mongodb-memory-server');
const { chromium } = require('../colin-backend/node_modules/playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
  process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'disposable-public-intake-browser-test';
  const directory = path.join(root, 'node_modules/.cache', `intake-e2e-${Date.now()}`);
  fs.mkdirSync(directory, { recursive: true });
  const binary = path.join(root, 'colin-backend/node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  console.log('Starting isolated real-API browser verification; outbound requests are blocked.');
  const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', ...(fs.existsSync(binary) ? { systemBinary: binary } : {}) }, instanceOpts: [{ launchTimeout: 120000 }], replSet: { count: 1, storageEngine: 'wiredTiger' } });
  let server, browser, page;
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'public_intake_browser_verification' });
    let app;
    server = http.createServer((req, res) => app(req, res)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    process.env.CLIENT_URL = base; process.env.PUBLIC_CLIENT_URL = base;
    app = require('../colin-backend/dist/app').default;
    app.use(express.static(path.join(root, 'build')));
    app.use((req, res) => req.path.startsWith('/api/') ? res.status(404).json({ message: 'Unknown API route' }) : res.sendFile(path.join(root, 'build/index.html')));
    const User = require('../colin-backend/dist/models/userModel').default;
    const Prospect = require('../colin-backend/dist/models/prospectModel').default;
    const Case = require('../colin-backend/dist/models/caseModel').default;
    const Notification = require('../colin-backend/dist/models/notificationModel').default;
    const { ClientIntakeSubmission: Submission, ClientIntakeAttachment: Attachment } = require('../colin-backend/dist/models/digitalIntakeModel');
    const { ARTICLES_GROUPS, MATTER_FIELDS, SHAREHOLDER_FIELDS } = require('../colin-backend/dist/config/digitalIntakeSchema');
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    const manager = await User.create({ name: 'Synthetic Intake Manager', email: 'manager@test.invalid', role: 'managing_partner', passwordHash: 'fixture' });
    const associate = await User.create({ name: 'Synthetic Intake Associate', email: 'associate@test.invalid', role: 'associate', passwordHash: 'fixture' });
    const staffToken = jwt.sign({ id: String(manager._id) }, process.env.JWT_SECRET);
    const api = async (route, body, method = body ? 'POST' : 'GET') => {
      const response = await fetch(base + '/api/digital-intake' + route, { method, headers: { Authorization: `Bearer ${staffToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json(); assert(response.ok, `API ${route}: ${response.status} ${JSON.stringify(data)}`); return data;
    };
    for (const origin of ['https://app.colinandcolin.com', 'https://colin-and-colin.vercel.app', 'https://colin-and-colin-t62y.vercel.app']) {
      const response = await fetch(base + '/api/digital-intake/public/form', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-intake-token' } });
      assert.equal(response.status, 204); assert.equal(response.headers.get('access-control-allow-origin'), origin);
    }
    await api('/configuration', { noticeText: 'Synthetic approved client notice for isolated verification.', noticeVersion: 'e2e-v1', privacyContact: 'privacy@test.invalid', retentionPolicy: 'Synthetic test-only retention.', noticeApproved: true }, 'PUT');
    const assignments = { responsiblePartner: String(manager._id), responsibleAssociate: String(associate._id), assignedTo: String(associate._id) };
    const invitation = await api('/links', { ...assignments, clientName: 'Synthetic Intake Company' });
    const clientPath = '/intake/form/' + invitation.token;
    browser = await chromium.launch({ executablePath: process.env.INTAKE_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    // Point the unchanged production frontend at the isolated real API. No responses are mocked.
    await context.addInitScript(({ base }) => {
      const resolve = value => { const url = new URL(String(value), location.href); return url.pathname.startsWith('/api/') ? base + url.pathname + url.search : value; };
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options) => originalFetch(resolve(url), options);
      const originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...args) { return originalOpen.call(this, method, resolve(url), ...args); };
    }, { base });
    page = await context.newPage();
    const errors = [], publicRequests = [], staffChunks = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/api/digital-intake/public/')) publicRequests.push(request);
      if (request.url().includes('/assets/StaffApp-')) staffChunks.push(request.url());
    });
    await page.goto(base + '/intake/form/not-a-valid-invitation');
    await page.getByRole('heading', { name: 'This link is unavailable' }).waitFor();
    // Even corrupt staff state must have no effect on an anonymous invitation.
    await page.evaluate(() => { localStorage.setItem('user', '{corrupt-staff-session'); localStorage.setItem('token', 'expired-staff-token'); });
    await page.goto(base + clientPath); await page.getByRole('heading', { name: 'Your details', exact: true }).waitFor();
    await page.reload(); await page.getByRole('heading', { name: 'Your details', exact: true }).waitFor();
    assert.equal(await page.locator('.intake-public').count(), 1); assert.equal(await page.locator('.dashboard-layout, .sidebar, aside').count(), 0); assert.equal(staffChunks.length, 0);
    assert.equal(await page.getByRole('button', { name: /log in|sign in/i }).count(), 0);
    const layout = async name => { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow: ${name}`); };
    const shot = name => page.screenshot({ path: path.join(directory, name + '.png'), fullPage: true });
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 }); await layout('identification at ' + width);
    }
    await shot('public-desktop-identification');
    await page.screenshot({ path: path.join(directory, 'public-desktop-first-screen.png') });
    const logoAlpha = await page.locator('.intake-brand img').evaluate(async image => {
      await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); return context.getImageData(0, 0, 1, 1).data[3];
    });
    assert.equal(logoAlpha, 0, 'The supplied header logo must have a transparent background.');
    assert.equal(await page.locator('.intake-client-form > .intake-field-section').count(), 3);
    await page.setViewportSize({ width: 390, height: 844 });
    await layout('client identification'); await shot('public-mobile-identification');
    assert.equal(await page.locator('#intake-identification').count(), 1);
    await page.getByRole('radio', { name: 'Company / Organization', exact: true }).check();
    assert.equal(await page.locator('#intake-identification').count(), 0);
    const client = { name: 'Synthetic Intake Company', tin: 'SYNTHETIC-TIN', representativeName: 'Synthetic Representative', representativeIdentification: 'SYNTHETIC-REP-ID', email: 'client@test.invalid', phone: '+250700000001', country: 'Rwanda', cityProvince: 'Synthetic city', district: 'Synthetic district', sector: 'Synthetic sector', cell: 'Synthetic cell', village: 'Synthetic village', profession: 'Director', contactName: 'Synthetic contact', contactPhone: '+250700000002' };
    for (const [key, value] of Object.entries(client)) await page.locator('#intake-' + key).fill(value);
    const next = async title => { await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.getByRole('heading', { name: title, exact: true }).waitFor(); };
    await next('Relevant parties');
    for (let index = 0; index < 2; index++) {
      await page.getByRole('button', { name: 'Add another party' }).click();
      await page.locator(`#party-${index}-name`).fill('Synthetic Party ' + (index + 1));
      await page.locator(`#party-${index}-relationship`).fill(index ? 'Beneficiary' : 'Co-owner');
    }
    await next('Legal matter'); await page.locator('#intake-service').selectOption('company_incorporation');
    const matter = Object.fromEntries(MATTER_FIELDS.map(q => [q.key, 'Synthetic ' + q.key]));
    for (const [key, value] of Object.entries(matter)) await page.locator('#intake-' + key).fill(value);
    await next('Supporting information');
    await page.getByLabel('My enquiry includes preparing Articles of Association').check();
    await page.locator('.intake-question-group').evaluateAll(items => items.forEach((item, index) => item.open = index === 0));
    await shot('public-mobile-questionnaire');
    await page.setViewportSize({ width: 1440, height: 1000 }); await shot('public-desktop-questionnaire');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.intake-question-group').count(), 10);
    await page.locator('.intake-question-group').evaluateAll(items => items.forEach(item => item.open = true));
    await page.getByLabel('We intend to appoint a Company Secretary').check();
    const answers = {};
    for (const question of ARTICLES_GROUPS.flatMap(group => group.questions)) {
      answers[question.key] = question.type === 'number' ? 2 : 'Synthetic ' + question.key;
      await page.locator('#intake-' + question.key).fill(String(answers[question.key]));
    }
    for (let index = 0; index < 2; index++) {
      await page.getByRole('button', { name: 'Add shareholder', exact: true }).click();
      for (const question of SHAREHOLDER_FIELDS) await page.locator(`#shareholder-${index}-${question.key}`).fill(question.type === 'number' ? String(question.key === 'percentage' ? index ? 60 : 40 : 2) : 'Synthetic shareholder ' + index + ' ' + question.key);
    }
    await layout('complete questionnaire');
    await next('Documents');
    const pdf = Buffer.from('%PDF-1.4\nSynthetic supporting document for isolated verification.\n%%EOF');
    await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-support.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.getByText('Uploaded securely', { exact: true }).waitFor();
    await next('Review & submit'); await layout('complete review'); await shot('public-mobile-review');
    await page.setViewportSize({ width: 1440, height: 1000 }); await layout('desktop review'); await shot('public-desktop-review');
    await page.locator('.intake-checkbox input').check();
    let interruptSubmit = true;
    await page.route('**/api/digital-intake/public/submit', route => { if (interruptSubmit) { interruptSubmit = false; return route.abort('failed'); } return route.continue(); });
    await page.getByRole('button', { name: 'Submit intake form' }).click();
    await page.getByRole('alert').filter({ hasText: 'The intake service could not be reached' }).waitFor();
    await page.getByRole('heading', { name: 'Review & submit', exact: true }).waitFor();
    assert.equal(await Submission.countDocuments({ linkId: invitation.link._id }), 0);
    assert.equal(await page.locator('.intake-checkbox input').isChecked(), true);
    await page.getByText(client.name, { exact: true }).waitFor();
    const submittedResponse = page.waitForResponse(response => response.url().endsWith('/api/digital-intake/public/submit') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Submit intake form' }).click();
    const submitted = await submittedResponse; assert.equal(submitted.status(), 200);
    const receipt = await submitted.json(); await page.getByText(receipt.reference, { exact: true }).waitFor(); await shot('public-confirmation');
    const stored = await Submission.findOne({ linkId: invitation.link._id }); assert(stored); assert.equal(stored.status, 'Awaiting Review');
    for (const [key, value] of Object.entries(client)) assert.equal(stored.form.client[key], value);
    assert.equal(stored.form.parties.length, 2); assert.equal(stored.form.shareholders.length, 2); assert.equal(stored.form.answers.appointSecretary, true);
    for (const [key, value] of Object.entries(answers)) assert.equal(stored.form.answers[key], value);
    for (const [key, value] of Object.entries(matter)) assert.equal(stored.form.matter[key], value);
    assert(stored.noticeAcknowledgment.at); assert.equal(await Prospect.countDocuments({}), 0); assert.equal(await Case.countDocuments({}), 0);
    assert.equal(await Attachment.countDocuments({ submissionId: stored._id }), 1);
    assert(await Notification.countDocuments({ dedupeKey: 'intake:' + stored._id }) >= 1);
    assert(publicRequests.every(request => !request.headers().authorization && !request.url().includes(invitation.token)));
    console.log('PASS: anonymous direct visit and refresh, stale staff state isolation, all six steps and all PDF questionnaire groups, real upload, interrupted submit recovery, persisted submission and notification');
    await page.evaluate(({ manager, token }) => { localStorage.setItem('user', JSON.stringify(manager)); localStorage.setItem('token', token); }, { manager: { id: String(manager._id), name: manager.name, email: manager.email, role: manager.role }, token: staffToken });
    await page.goto(base + '/matters/intake-prospects'); await page.getByRole('button', { name: 'Client Submissions', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: receipt.reference }); await row.waitFor();
    await row.getByRole('button', { name: 'Review submission' }).click(); await page.getByRole('heading', { name: client.name, exact: true }).waitFor();
    await page.getByText('synthetic-support.pdf', { exact: true }).waitFor(); await shot('staff-submission-review');
    page.on('dialog', dialog => dialog.accept());
    const acceptedResponse = page.waitForResponse(response => response.url().endsWith(`/submissions/${stored._id}/accept`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Accept into prospect pipeline' }).click();
    const accepted = await acceptedResponse; assert.equal(accepted.status(), 200, await accepted.text());
    const prospect = await Prospect.findOne({ intakeSubmissionId: stored._id }); assert(prospect); assert.equal(prospect.stage, 'Inquiry'); assert.equal(prospect.clientName, client.name); assert.equal(await Case.countDocuments({}), 0);
    await page.goto(base + clientPath); await page.getByRole('heading', { name: 'Your form has been received', exact: true }).waitFor();
    assert.equal(await Submission.countDocuments({ linkId: invitation.link._id }), 1); assert.equal(await Prospect.countDocuments({ intakeSubmissionId: stored._id }), 1); assert.deepEqual(errors, []);
    console.log('PASS: actual staff Client Submissions list and review, acceptance into one Inquiry prospect, no Active Matter and safe already-submitted state');
    console.log('Real-API browser verification complete. Synthetic screenshots: ' + directory);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await mongoose.disconnect(); await replica.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
