/** Local Edge browser checks using synthetic API fixtures; no deployed services or client records. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const express = require('../colin-backend/node_modules/express');
const { INTAKE_SERVICES, QUESTIONNAIRES } = require('../colin-backend/dist/config/digitalIntakeSchema');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, limit = 15000) { const end = Date.now() + limit; while (Date.now() < end) { const result = await fn(); if (result) return result; await delay(100); } throw Error(`Timed out: ${label}`); }
async function main() {
  const executable = process.env.INTAKE_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  if (!fs.existsSync(executable)) throw Error('Set INTAKE_TEST_BROWSER to an installed Chromium/Edge executable.');
  const directory = path.join(root, 'node_modules/.cache', `intake-browser-${Date.now()}`); fs.mkdirSync(directory, { recursive: true });
  console.log('Starting local browser verification...');
  const hosting = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')); assert.equal(hosting.outputDirectory, 'build'); assert(hosting.rewrites.some(route => route.source === '/(.*)' && route.destination === '/index.html'));
  const app = express(); app.use(express.static(path.join(root, hosting.outputDirectory))); app.use((_req, res) => res.sendFile(path.join(root, hosting.outputDirectory, 'index.html')));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${directory}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let ws;
  try {
    const portFile = path.join(directory, 'DevToolsActivePort'); await until(() => fs.existsSync(portFile), 'browser debugging endpoint', 30000);
    const port = await until(() => { try { return fs.readFileSync(portFile, 'utf8').split('\n')[0].trim() || false; } catch { return false; } }, 'browser port file readable');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await Promise.race([once(ws, 'open'), delay(10000).then(() => { throw Error('Browser socket startup timeout'); })]); console.log('Browser connected.');
    let serial = 0; const pending = new Map();
    ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); clearTimeout(pending.get(message.id).timer); pending.delete(message.id); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); } });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 30000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
    const service = INTAKE_SERVICES.find(s => s.id === 'company_incorporation');
    const fixtures = { expiresAt: new Date(Date.now() + 86400000).toISOString(), introduction: 'A confidential first step with our team.', serviceId: '', questionnaireId: '', notice: { version: 'test-v1', text: 'Synthetic approved privacy and client notice.', contact: 'privacy@test.invalid', retention: 'Synthetic retention policy.' }, services: INTAKE_SERVICES, questionnaires: QUESTIONNAIRES };
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const fixtures = ${JSON.stringify(fixtures)}; window.__intakePayloads = []; window.__invitationRequests = [];
      const scenario = new URLSearchParams(window.location.search).get('intakeTest') || '';
      window.__emailConfigured = scenario !== 'email-setup'; window.__emailRejected = scenario === 'email-retry'; window.__sentEmails = 0;
      window.__failStaff = scenario === 'staff-failure'; window.__failConfiguration = scenario === 'configuration-failure'; window.__rejectGeneration = scenario === 'generation-failure';
      let noticeSettings = { noticeApproved: scenario !== 'privacy-setup', noticeVersion: 'test-v1', noticeText: fixtures.notice.text, privacyContact: fixtures.notice.contact, retentionPolicy: fixtures.notice.retention, defaultExpiryDays: 7 };
      const original = window.fetch.bind(window);
      window.fetch = async (url, options = {}) => {
        const location = String(url); if (!location.includes('/api/')) return original(url, options);
        const result = data => Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        if (location.endsWith('/public/form')) {
          if (scenario === 'public-html') return new Response('<html>Old frontend fallback</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
          if (scenario === 'public-malformed') return result({ services: [] });
          if (scenario === 'public-network') throw new TypeError('Failed to fetch');
          if (window.location.pathname.includes('expired')) return new Response(JSON.stringify({ code: 'EXPIRED_LINK', message: 'This intake link has expired. Please request a new link.' }), { status: 410 });
          return result(fixtures);
        }
        if (location.endsWith('/public/submit')) { window.__intakePayloads.push(JSON.parse(options.body)); return result({ reference: 'INT-UI-TEST' }); }
        if (location.endsWith('/public/clarification')) return result({ reference: 'INT-UI-TEST', message: 'Please confirm your intended deadline.' });
        if (location.endsWith('/public/clarification/reply')) return result({ reference: 'INT-UI-TEST', received: true });
        if (location.endsWith('/configuration')) {
          if (options.method === 'PUT') { noticeSettings = JSON.parse(options.body); return result(noticeSettings); }
          if (window.__failConfiguration) return new Response(JSON.stringify({ message: 'Settings are temporarily unavailable.' }), { status: 503 });
          return result({ services: fixtures.services, settings: noticeSettings, canManage: true, delivery: { email: { configured: window.__emailConfigured, message: window.__emailConfigured ? 'Email configured.' : 'An administrator must set RESEND_API_KEY and EMAIL_FROM on the backend service.' }, publicUrl: { configured: true, origin: window.location.origin, message: 'Public invitation address configured.' } } });
        }
        if (location.endsWith('/users/assignment-options')) {
          if (window.__failStaff) return new Response(JSON.stringify({ message: 'Staff are temporarily unavailable.' }), { status: 503 });
          return result([{ _id: '333333333333333333333333', name: 'Synthetic Partner', role: 'partner', isActive: true }, { _id: '444444444444444444444444', name: 'Synthetic Associate', role: 'associate', isActive: true }]);
        }
        if (location.endsWith('/digital-intake/links') && options.method === 'POST') {
          const body = JSON.parse(options.body); window.__invitationRequests.push(body);
          if (window.__rejectGeneration) return new Response(JSON.stringify({ message: 'Generation temporarily unavailable. Please retry.' }), { status: 503 });
          if (!noticeSettings.noticeApproved) return new Response(JSON.stringify({ code: 'NOTICE_APPROVAL_REQUIRED', message: 'Management must approve the privacy notice first.' }), { status: 409 });
          return result({ link: { _id: '111111111111111111111111', expiresAt: fixtures.expiresAt, clientName: body.clientName || '', clientEmail: body.clientEmail || '' }, token: 'synthetic-token', url: window.location.origin + '/intake/form/synthetic-token' });
        }
        if (location.includes('/digital-intake/links/') && location.endsWith('/send')) { if (window.__emailRejected) return result({ sent: false, code: 'EMAIL_DOMAIN_UNVERIFIED', message: 'The sender domain is not verified. Verify it in Resend and correct EMAIL_FROM.' }); window.__sentEmails++; return result({ sent: true, message: 'Invitation accepted by the email provider.' }); }
        if (location.includes('notifications')) return result({ items: [], unreadCount: 0 });
        return result([]);
      };
      window.XMLHttpRequest = class {
        constructor() { this.upload = {}; this.status = 201; this.responseText = JSON.stringify({ _id: '222222222222222222222222', name: 'synthetic.pdf' }); }
        open() {} setRequestHeader() {} send() { setTimeout(() => { this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 }); this.onload?.(); }, 10); }
      };
    })();` });
    const goto = async route => { await cdp('Page.navigate', { url: base + route }); await until(() => evaluate('!!document.querySelector(".intake-public,.intake-staff")'), route); };
    const text = () => evaluate('document.body.innerText');
    const click = label => evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find(e => e.innerText.trim() === ${JSON.stringify(label)}); if (!b) throw Error('Button missing: ' + ${JSON.stringify(label)}); b.click(); })()`);
    const input = (id, value) => evaluate(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) throw Error('Input missing: ' + ${JSON.stringify(id)}); const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const step = title => until(() => evaluate(`document.querySelector('.intake-card h2')?.textContent === ${JSON.stringify(title)}`), title);
    for (const [scenario, message] of [['public-html', 'unexpected response'], ['public-malformed', 'public intake form could not be loaded'], ['public-network', 'service could not be reached']]) {
      await goto('/intake/form/' + 'S'.repeat(43) + '?intakeTest=' + scenario);
      await until(async () => (await text()).includes(message), 'public API recovery: ' + scenario);
      assert(await evaluate('!!document.querySelector(".intake-brand img") && !document.querySelector("aside,.sidebar,.dashboard-layout")'));
    }
    console.log('PASS: HTML fallback, malformed public configuration and network failures show branded recovery screens');
    await goto('/intake/form/' + 'S'.repeat(43)); await step('Your details');
    assert(await evaluate("!!document.getElementById('intake-identification') && !document.getElementById('intake-tin')"));
    await click('Next'); assert(await evaluate("document.querySelector('.intake-card h2').textContent === 'Your details'"));
    await evaluate("Array.from(document.querySelectorAll('input[type=radio]'))[1].click()");
    assert(await evaluate("!!document.getElementById('intake-tin') && !document.getElementById('intake-identification')"));
    for (const [id, value] of Object.entries({ name: 'Synthetic Company', tin: 'TEST-TIN', representativeName: 'Synthetic Representative', representativeIdentification: 'TEST-REP', email: 'client@test.invalid', phone: '+250700000001', country: 'Rwanda' })) await input('intake-' + id, value);
    await click('Next'); await step('Relevant parties'); await click('Add another party'); await click('Add another party');
    await input('party-0-name', 'Synthetic Party One'); await input('party-1-name', 'Synthetic Party Two'); assert.equal(await evaluate("document.querySelectorAll('.intake-repeat').length"), 2);
    await click('Next'); await step('Legal matter'); await input('intake-service', service.id);
    for (const [id, value] of Object.entries({ inquiry: 'Synthetic incorporation enquiry', objectives: 'Record proposed arrangements', overview: 'Synthetic company formation background' })) await input('intake-' + id, value);
    await click('Next'); await step('Supporting information'); await evaluate("document.querySelector('.intake-checkbox input').click()");
    assert.equal(await evaluate("document.querySelectorAll('.intake-question-group').length"), QUESTIONNAIRES[0].groups.length);
    await evaluate("Array.from(document.querySelectorAll('details')).find(e => e.querySelector('summary').textContent.includes('Shareholders and share capital')).open = true");
    await click('Add shareholder'); await input('shareholder-0-name', 'Synthetic Shareholder'); await input('shareholder-0-percentage', '40'); assert.match(await text(), /Proposed ownership total: 40%/);
    const layout = async (width, height, mobile) => { await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }); await delay(200); assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), `Horizontal overflow at ${width}`); };
    await layout(390, 844, true); fs.writeFileSync(path.join(directory, 'intake-mobile.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await click('Next'); await step('Documents');
    const pdf = path.join(directory, 'synthetic.pdf'); fs.writeFileSync(pdf, '%PDF-1.4\nSynthetic browser fixture');
    const document = await cdp('DOM.getDocument'); const fileNode = await cdp('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[type=file]' }); await cdp('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [pdf] }); await until(async () => (await text()).includes('Uploaded securely'), 'upload progress');
    await click('Next'); await step('Review & submit'); assert.match(await text(), /Synthetic Party Two/); assert.match(await text(), /Synthetic Shareholder/);
    await evaluate("document.querySelector('.intake-checkbox input').click()"); await click('Submit intake form'); await until(async () => (await text()).includes('INT-UI-TEST'), 'success screen');
    const payloads = await evaluate('window.__intakePayloads'); assert.equal(payloads.length, 1); assert.equal(payloads[0].parties.length, 2); assert.equal(payloads[0].shareholders[0].percentage, 40); assert.equal(payloads[0].documentIds.length, 1);
    console.log('PASS: conditional identification, validation, parties, AoA/shareholders, mobile layout, upload progress, review and submit');
    await layout(1440, 1000, false); await goto('/intake/form/expired'); await until(async () => (await text()).includes('has expired'), 'expired link');
    await goto('/intake/form/' + 'S'.repeat(43)); await step('Your details'); fs.writeFileSync(path.join(directory, 'intake-desktop.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await goto('/intake/clarification/' + 'C'.repeat(43)); await until(async () => (await text()).includes('intended deadline'), 'clarification'); await input('clarification-response', 'Synthetic confirmation'); await click('Send secure reply'); await until(async () => (await text()).includes('received your reply'), 'clarification success');
    console.log('PASS: desktop layout, expired-link state and clarification reply');
    await evaluate(`localStorage.setItem('user', JSON.stringify({ id: '111111111111111111111111', name: 'Synthetic Manager', email: 'manager@test.invalid', role: 'managing_partner' })); localStorage.setItem('token', 'synthetic-staff-token')`);
    await cdp('Page.navigate', { url: base + '/matters/intake-prospects' }); await until(async () => (await text()).includes('Generate Intake Link'), 'staff intake dashboard');
    await click('Generate Intake Link'); await until(() => evaluate('!!document.querySelector(".intake-modal")'), 'generate dialog'); await input('invite-name', 'Synthetic Invitation'); await input('invite-email', 'client@test.invalid'); await click('Generate secure link');
    await until(() => evaluate('!!document.getElementById("generated-intake-url")'), 'generated link'); assert.match(await evaluate('document.getElementById("generated-intake-url").value'), /\/intake\/form\//);
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }); await until(() => evaluate('!document.querySelector(".intake-modal")'), 'Escape closes dialog');
    await click('Client Submissions'); await until(async () => (await text()).includes('No client submissions yet'), 'submissions empty state'); await click('Prospects'); await click('Client Submissions'); await until(async () => (await text()).includes('No client submissions yet'), 'return to submissions'); assert(await evaluate('!document.querySelector(".intake-modal")')); console.log('PASS: staff dashboard, link generation, keyboard dismissal and submissions tab');
    const generateButtonDisabled = () => evaluate("Array.from(document.querySelectorAll('.intake-invite-dialog button')).find(button => button.type === 'submit')?.disabled");
    const openInvitation = async (scenario = '') => {
      await cdp('Page.navigate', { url: base + '/matters/intake-prospects' + (scenario ? '?intakeTest=' + scenario : '') });
      await until(async () => (await text()).includes('Generate Intake Link'), 'staff workspace');
      await click('Generate Intake Link'); await until(() => evaluate('!!document.getElementById("invite-name")'), 'invitation form');
    };
    for (const theme of ['light', 'dark']) {
      await evaluate(`localStorage.setItem('theme', '${theme}')`);
      await layout(1440, 1000, false); await openInvitation(); await until(async () => !(await generateButtonDisabled()), 'ready invitation');
      await input('invite-name', 'Theme verification client'); await input('invite-email', 'client@test.invalid');
      const colors = await evaluate("({ background: getComputedStyle(document.querySelector('.intake-invite-dialog')).backgroundColor, text: getComputedStyle(document.querySelector('#intake-generate-title')).color, dark: document.documentElement.classList.contains('dark') })");
      assert.equal(colors.dark, theme === 'dark'); assert.notEqual(colors.background, colors.text);
      assert.equal(colors.background, theme === 'dark' ? 'rgb(17, 29, 45)' : 'rgb(255, 255, 255)');
      const footerVisible = () => evaluate('document.querySelector(".intake-invite-footer").getBoundingClientRect().bottom <= innerHeight'); assert(await footerVisible());
      fs.writeFileSync(path.join(directory, `intake-generate-${theme}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await layout(390, 844, true);
      assert(await evaluate('document.querySelector(".intake-invite-dialog").scrollWidth <= document.querySelector(".intake-invite-dialog").clientWidth + 1')); assert(await footerVisible());
      fs.writeFileSync(path.join(directory, `intake-generate-mobile-${theme}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await click('Generate secure link'); await until(() => evaluate('!!document.getElementById("generated-intake-url")'), 'successful themed generation');
      assert.equal((await evaluate('window.__invitationRequests'))[0].clientName, 'Theme verification client');
    }
    console.log('PASS: generation succeeds in light/dark themes and desktop/mobile dialogs keep actions visible');
    await layout(1440, 1000, false); await openInvitation('staff-failure');
    await until(async () => (await text()).includes('Staff members could not load'), 'optional staff warning'); assert.equal(await generateButtonDisabled(), false);
    await input('invite-name', 'Unassigned invitation'); await click('Generate secure link'); await until(() => evaluate('!!document.getElementById("generated-intake-url")'), 'generation despite staff outage');
    assert.equal((await evaluate('window.__invitationRequests'))[0].assignedTo, '');
    await openInvitation('configuration-failure'); await until(async () => (await text()).includes('Invitation settings could not load'), 'settings error'); assert.equal(await generateButtonDisabled(), true);
    await input('invite-name', 'Draft preserved after reload'); await evaluate('window.__failConfiguration = false'); await click('Retry settings'); await until(async () => !(await generateButtonDisabled()), 'settings recovery'); assert.equal(await evaluate('document.getElementById("invite-name").value'), 'Draft preserved after reload');
    console.log('PASS: optional staff failures do not block generation; settings failures explain recovery and preserve entries');
    await openInvitation('privacy-setup'); await until(async () => (await text()).includes('Privacy approval is needed'), 'privacy blocker'); await input('invite-name', 'Privacy setup draft'); assert.equal(await generateButtonDisabled(), true);
    await click('Review privacy notice'); await until(() => evaluate('!!document.getElementById("notice-settings-title")'), 'notice settings');
    await evaluate('document.querySelector("#notice-settings-title").closest("section").querySelector("input[type=checkbox]").click()'); await click('Save notice settings');
    await until(() => evaluate('!document.getElementById("notice-settings-title")'), 'notice settings saved'); assert.equal(await evaluate('document.getElementById("invite-name").value'), 'Privacy setup draft'); assert.equal(await generateButtonDisabled(), false);
    await click('Generate secure link'); await until(() => evaluate('!!document.getElementById("generated-intake-url")'), 'generation after approval');
    console.log('PASS: manager can resolve privacy setup inside the dialog without losing invitation details');
    await openInvitation(); await until(async () => !(await generateButtonDisabled()), 'validation form ready');
    await input('invite-email', 'invalid'); await click('Generate secure link'); await until(() => evaluate('!!document.getElementById("invite-email-error")'), 'inline email error'); assert.equal(await evaluate('window.__invitationRequests.length'), 0);
    await input('invite-email', ''); await evaluate('document.querySelector("input[name=invite-validity][value=custom]").click()'); await input('invite-expiry', '0'); await click('Generate secure link'); assert.match(await text(), /whole number between 1 and 30/); assert.equal(await evaluate('window.__invitationRequests.length'), 0);
    await input('invite-expiry', '10'); await click('Generate secure link'); await until(() => evaluate('!!document.getElementById("generated-intake-url")'), 'valid custom expiry'); assert.equal((await evaluate('window.__invitationRequests'))[0].expiryDays, 10);
    await openInvitation('generation-failure'); await until(async () => !(await generateButtonDisabled()), 'retry form ready'); await input('invite-name', 'Retry draft'); await click('Generate secure link'); await until(async () => (await text()).includes('Generation temporarily unavailable'), 'generation error'); assert.equal(await evaluate('document.getElementById("invite-name").value'), 'Retry draft');
    await evaluate('window.__rejectGeneration = false'); await click('Generate secure link'); await until(() => evaluate('!!document.getElementById("generated-intake-url")'), 'generation retry');
    console.log('PASS: inline email/expiry validation and generation errors support a successful retry');
    await openInvitation('email-setup'); await until(async () => !(await generateButtonDisabled()), 'email setup form'); await input('invite-email', 'client@test.invalid'); await click('Generate secure link'); await until(() => evaluate('!!document.getElementById("generated-intake-url")'), 'copy while email disabled');
    assert.match(await text(), /Email setup required/); assert.match(await text(), /RESEND_API_KEY and EMAIL_FROM/); assert.match(await text(), /Email unavailable/); assert(await evaluate('!!document.querySelector("a.intake-invite-open-link[target=_blank]")'));
    await evaluate('window.__emailConfigured = true'); await click('Recheck email setup'); await until(async () => (await text()).includes('Send via email'), 'email setup reload'); await click('Send via email'); await until(async () => (await text()).includes('Email sent'), 'confirmed email send'); assert.equal(await evaluate('window.__sentEmails'), 1);
    await openInvitation('email-retry'); await until(async () => !(await generateButtonDisabled()), 'email retry form'); await input('invite-email', 'client@test.invalid'); await click('Generate secure link'); await until(() => evaluate('!!document.getElementById("generated-intake-url")'), 'email retry invitation'); await click('Send via email'); await until(async () => (await text()).includes('sender domain is not verified'), 'precise email failure'); assert(await evaluate('!!document.getElementById("generated-intake-url")'));
    await evaluate('window.__emailRejected = false'); await click('Send via email'); await until(async () => (await text()).includes('Email sent'), 'provider recovered');
    const directUrl = await evaluate('document.getElementById("generated-intake-url").value'); const directResponse = await fetch(directUrl); assert.equal(directResponse.status, 200); assert.match(await directResponse.text(), /<div id="root"/);
    await evaluate("localStorage.removeItem('user'); localStorage.removeItem('token')"); await cdp('Page.navigate', { url: directUrl }); await step('Your details'); await cdp('Page.reload', { ignoreCache: true }); await step('Your details');
    console.log('PASS: copied links open anonymously after refresh; missing email setup, provider failures and successful retries are clearly shown');
    console.log(`Browser verification complete. Screenshots: ${directory}`);
  } finally { if (ws) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' })); ws.close(); } child.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
