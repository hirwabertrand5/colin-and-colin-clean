/** Synthetic templates and mocked provider transport; never reads .env or sends mail. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { EMAIL_LOGO_CID, emailLogoAttachment } from '../services/emailBranding';
import { buildIntakeInvitationEmail, buildIntakeClarificationEmail, buildIntakeReceiptEmail, buildIntakeSummaryEmail } from '../services/intakeEmailService';
import { buildNotificationEmail } from '../services/notificationTemplateService';
import { sendEmailResend } from '../services/emailResendService';

async function main() {
  const asset = emailLogoAttachment();
  assert(Buffer.from(asset.content, 'base64').subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  const invitation = buildIntakeInvitationEmail({ name: 'Sample client', message: 'Please complete your intake form so our team can review your enquiry.\nYou can save your progress and return when convenient.', url: 'https://example.invalid/intake/form/sample-private-link', expiresAt: '2026-11-30T10:00:00Z' });
  const hostile = buildIntakeInvitationEmail({ name: '<script>bad</script>', message: 'Line one\n<img src=x onerror=bad>', url: 'https://example.invalid/intake/form/sample', expiresAt: '2026-11-30T10:00:00Z' });
  assert(!hostile.includes('<script>')); assert(!hostile.includes('<img src=x')); assert(hostile.includes('Line one<br>'));
  assert(invitation.includes('12:00 (Kigali time)')); assert(invitation.indexOf(`cid:${EMAIL_LOGO_CID}`) > invitation.indexOf('Complete intake form'));
  assert(!invitation.includes('<h2>Colin')); assert.equal((invitation.match(/src="cid:/g) || []).length, 1);
  const submission = { reference: 'INT-SAMPLE-001', submittedAt: new Date('2026-11-15T10:00:00Z'), form: { client: { name: 'Sample client', email: 'client@test.invalid' }, parties: [], matter: { inquiry: 'Sample enquiry', overview: 'Synthetic data for layout verification', objectives: 'Verify the email layout' }, serviceId: 'contractual_disputes', shareholders: [], answers: {} } };
  const templates = {
    invitation,
    receipt: buildIntakeReceiptEmail(submission),
    clarification: buildIntakeClarificationEmail({ name: 'Sample client', reference: submission.reference, message: 'Please attach the requested supporting document.', url: 'https://example.invalid/intake/clarification/sample', expiresAt: '2026-11-30T10:00:00Z' }),
    summary: buildIntakeSummaryEmail(submission, [{ name: 'sample.pdf', section: 'National ID' }], 'https://example.invalid/matters/intake-prospects'),
    notification: buildNotificationEmail({ title: 'Sample notification', message: '<script>escaped</script>' }),
  };
  for (const html of Object.values(templates)) { assert(html.includes(`cid:${EMAIL_LOGO_CID}`)); assert(!html.includes('<script>')); }
  assert(templates.receipt.includes(submission.reference)); assert(templates.summary.includes(submission.form.matter.overview));
  console.log('PASS: invitation, receipt, clarification, summary and platform email share the logo signature; escaped copy and Kigali expiry.');
  const prior = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM, reply: process.env.EMAIL_REPLY_TO };
  const nativeFetch = globalThis.fetch;
  let calls = 0;
  process.env.RESEND_API_KEY = 're_synthetic_branding_verification'; process.env.EMAIL_FROM = 'Verification <sender@test.invalid>'; process.env.EMAIL_REPLY_TO = 'reply@test.invalid';
  globalThis.fetch = async (input, options) => {
    assert(String(input).startsWith('https://api.resend.com/')); const payload = JSON.parse(String(options?.body));
    assert.deepEqual(payload.to, ['client@test.invalid']);
    assert.equal(payload.attachments.length, 1); assert.equal(payload.attachments[0].content_id, EMAIL_LOGO_CID);
    assert.equal(payload.attachments[0].content_type, 'image/png'); assert.equal(typeof payload.attachments[0].content, 'string'); assert.equal(payload.attachments[0].content, asset.content);
    calls++; return new Response(JSON.stringify({ id: `synthetic-email-${calls}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    for (const html of Object.values(templates)) assert((await sendEmailResend(['client@test.invalid'], 'Synthetic branding verification', html, { idempotencyKey: `branding/${calls}` })).ok);
    assert.equal(calls, 5);
  } finally {
    globalThis.fetch = nativeFetch;
    for (const [key, value] of Object.entries({ RESEND_API_KEY: prior.key, EMAIL_FROM: prior.from, EMAIL_REPLY_TO: prior.reply })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  console.log('PASS: provider receives the actual PNG as an inline attachment for all five templates; no external images or real sends.');
  const directory = path.resolve(__dirname, '../../../node_modules/.cache/email-branding'); fs.mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.INTAKE_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    for (const [name, html] of Object.entries(templates)) {
      const preview = html.replace(`cid:${EMAIL_LOGO_CID}`, `data:image/png;base64,${asset.content}`);
      fs.writeFileSync(path.join(directory, `${name}.html`), preview);
      for (const width of [320, 390, 760]) {
        await page.setViewportSize({ width, height: 1000 }); await page.setContent(preview);
        await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflow at ${width}`);
        assert(await page.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth > 0));
        if (name === 'invitation' || name === 'receipt') await page.screenshot({ path: path.join(directory, `${name}-${width}.png`), fullPage: true });
      }
    }
  } finally { await browser.close(); }
  console.log(`PASS: five email previews fit 320px, 390px and desktop widths. Preview files: ${directory}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
