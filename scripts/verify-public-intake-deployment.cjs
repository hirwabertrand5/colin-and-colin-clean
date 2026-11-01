/** Read-only deployment audit. GET assets and OPTIONS only; browser API requests are blocked. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('../colin-backend/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const activeOrigin = 'https://colin-and-colin.vercel.app';
const origins = [activeOrigin, 'https://colin-and-colin-t62y.vercel.app', 'https://app.colinandcolin.com'];
const backend = 'https://colin-and-colin.onrender.com/api/digital-intake';
const markers = ['/intake/form/:token', 'Your details', 'Relevant parties', 'Submit intake form', '/public/form', '/public/submit'];
async function main() {
  const directory = path.join(root, 'node_modules/.cache', 'intake-production-audit'); fs.mkdirSync(directory, { recursive: true });
  const report = { checkedAt: new Date().toISOString(), readOnly: true, activeOrigin, frontend: [], api: [], productionVerified: false };
  for (const origin of origins) {
    try {
      const response = await fetch(origin + '/intake/form/deployment-check', { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      const html = await response.text(); const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)/g)].map(match => match[1]);
      const assets = [];
      for (const script of scripts) {
        const assetUrl = new URL(script, response.url); if (assetUrl.origin !== origin) continue;
        const asset = await fetch(assetUrl, { signal: AbortSignal.timeout(20000), cache: 'no-store' }); const js = await asset.text();
        assets.push({ path: assetUrl.pathname, status: asset.status, bytes: Buffer.byteLength(js), sha256: createHash('sha256').update(js).digest('hex'), markers: Object.fromEntries(markers.map(marker => [marker, js.includes(marker)])) });
      }
      report.frontend.push({ origin, status: response.status, server: response.headers.get('server'), reactRoot: html.includes('id="root"'), assets, nativeFormInEntry: markers.every(marker => assets.some(asset => asset.markers[marker])) });
    } catch (error) { report.frontend.push({ origin, error: error.message, cause: error.cause?.code }); }
    try {
      const response = await fetch(backend + '/public/form', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-intake-token' }, signal: AbortSignal.timeout(20000) });
      report.api.push({ origin, status: response.status, allowedOrigin: response.headers.get('access-control-allow-origin') });
    } catch (error) { report.api.push({ origin, error: error.message }); }
  }
  if (process.argv.includes('--browser')) {
    const browser = await chromium.launch({ executablePath: process.env.INTAKE_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    try {
      for (let index = 0; index < origins.length; index++) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        // No live invitation is validated, marked opened, or submitted by this audit.
        await page.route('**/api/**', route => route.abort());
        try {
          await page.goto(origins[index] + '/intake/form/deployment-check', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForFunction(() => document.body.innerText.trim().length > 25, { timeout: 20000 });
          await page.screenshot({ path: path.join(directory, `production-${index}.png`), fullPage: true });
          const result = report.frontend.find(item => item.origin === origins[index]);
          result.browser = { pathname: new URL(page.url()).pathname, standaloneIntake: await page.locator('.intake-public').count() === 1, pageText: (await page.locator('body').innerText()).slice(0, 500), apiBlocked: true };
        } catch (error) { report.frontend.find(item => item.origin === origins[index]).browserError = error.message; }
        await page.close();
      }
    } finally { await browser.close(); }
  }
  // HTML/asset/CORS checks alone cannot certify a valid live submission.
  report.productionVerified = false;
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('Audit evidence: ' + directory);
  const activeFrontend = report.frontend.find(item => item.origin === activeOrigin);
  const activeApi = report.api.find(item => item.origin === activeOrigin);
  if (!activeFrontend?.nativeFormInEntry || activeApi?.status !== 204 || activeApi.allowedOrigin !== activeOrigin) process.exitCode = 2;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
