// Audit real sidebar links in the production bundle; all API traffic is intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const origin = 'http://127.0.0.1:5178';
const roles = ['managing_director', 'executive_assistant', 'associate'];
const totals = { activeCases: 0, billed: 0, collected: 0, outstanding: 0, contractValue: 0, totalContractValue: 0,
  totalBilled: 0, totalCollected: 0, progressValue: 0, directMatterCosts: 0, totalDirectMatterCosts: 0, grossProfit: 0,
  grossProfitMargin: 0, firmOperatingExpenses: 0, netProfit: 0, netProfitMargin: 0, clientRelatedExpenses: 0 };
const range = { from: '2026-11-01', to: '2026-11-30' };
const report = { range, kpis: totals, team: [], months: [], caseTypes: [], clientProfitability: [], ageingReport: [],
  productivityRows: [], productivitySummary: {}, expenseTypes: [], selectedMember: null };
const results = [];
const menuGroups = [];
const failures = [];
const auditPath = path.resolve(__dirname, '../../docs/sidebar-navigation-audit.json');
const previous = process.argv.includes('--retry-failed') && fs.existsSync(auditPath) ? JSON.parse(fs.readFileSync(auditPath, 'utf8')) : null;
if (previous) { results.push(...previous.destinations); menuGroups.push(...previous.menuGroups); }

async function main() {
  const options = { headless: true };
  if (!fs.existsSync(chromium.executablePath())) options.channel = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : 'msedge';
  const browser = await chromium.launch(options);
  const audited = new Set(results.map(result => `${result.role}:${result.href}`));
  try {
    for (const role of roles) {
      if (previous && !previous.failures.some(failure => failure.role === role)) continue;
      const actor = { id: 'nav-user', name: 'Navigation User', email: 'navigation@ui.invalid', role };
      const cases = Array.from({ length: 15 }, (_, i) => ({ _id: String(i + 1).padStart(24, '0'), caseNo: `NAV-${i}`, parties: `Fixture Client ${i}`,
        caseType: 'Transactional Cases', status: ['In Progress', 'Closed', 'Temporarily Closed'][i % 3], assignedTo: actor.name,
        caseAssignments: { initiator: actor.name, reviewer: 'Reviewer', signerApprover: 'Approver' }, budget: '100000',
        createdAt: '2026-11-01T08:00:00Z', updatedAt: '2026-11-05T08:00:00Z', billingSettings: { currency: 'RWF' },
        workflowProgress: { status: i % 3 === 1 ? 'Completed' : 'In Progress', percent: 0, currentStepTitle: 'Fixture work', nextDueAt: '2026-12-01T08:00:00Z' } }));
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      page.setDefaultTimeout(6000);
      let currentTarget = 'initial';
      page.on('pageerror', error => failures.push({ role, href: currentTarget, error: error.message }));
      await page.addInitScript(user => { localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('token', 'navigation-test-only'); }, actor);
      await page.route('**/*', async route => {
        const request = route.request();
        if (!['fetch', 'xhr'].includes(request.resourceType())) return route.continue();
        assert.equal(request.method(), 'GET', 'Navigation must not mutate data');
        const url = new URL(request.url()); const key = url.pathname;
        let body = [];
        if (key.endsWith('/cases') || key.endsWith('/cases/independent-task-options')) body = cases;
        else if (key.includes('/expenses/batch')) body = Object.fromEntries((url.searchParams.get('caseIds') || url.searchParams.get('fundIds') || '').split(',').filter(Boolean).map(id => [id, []]));
        else if (key.endsWith('/reports/firm') || key.endsWith('/reports/my-productivity')) body = report;
        else if (key.endsWith('/billing/summary')) body = { ...totals, ...range, months: [] };
        else if (key.includes('/reports/profitability') || key.includes('/reports/staff-earnings')) body = { ...report, summary: totals, totals, rows: [], items: [], groups: [], staff: [], matters: [], warnings: [], availableCurrencies: ['RWF'] };
        else if (key.endsWith('/independent-tasks/dashboard')) body = { summary: { totalTasks: 0, openTasks: 0, overdueTasks: 0 }, priorityDistribution: [], recentActivities: [], upcomingDeadlines: [], assignedToMe: [], tasksDueToday: [] };
        else if (key.endsWith('/independent-tasks')) body = { items: [], total: 0, page: 1, limit: 20 };
        else if (key.endsWith('/performance/me')) body = { range, user: actor, tasksCompleted: 0, tasksTotal: 0, onTimeCompletionPct: 0,
          approvals: { pending: 0, approved: 0, rejected: 0, approvalRatePct: null }, rating: { value: null, productivityScore: 0, qualityScore: null, reliabilityScore: null }, monthly: [], byStatus: [], byPriority: [] };
        else if (key.endsWith('/dashboard/executive-assistant')) body = { stats: {}, today: { dateISO: '2026-11-10', label: 'Today' }, todaySchedule: [], pendingFollowUp: [], recentCases: [] };
        else if (key.endsWith('/dashboard/staff-summary')) body = { user: actor, rows: [], period: { isAllTime: true, key: 'all', label: 'All time', feesEarned: 0 },
          mattersAssigned: 0, mattersCompleted: 0, mattersOutstanding: 0, feesEarnedTotal: 0, collectedBaseTotal: 0, overdueSections: 0, tpaPercent: 1, currency: 'RWF' };
        else if (key.includes('audit') && key.includes('/me')) body = { items: [], total: 0, page: 1, pages: 1 };
        else if (key.endsWith('/users') || key.includes('/users/staff') || key.includes('/users/assignment-options')) body = [{ _id: actor.id, ...actor, isActive: true }];
        else if (key.endsWith('/funds/active')) body = null;
        else if (key.endsWith('/prospects/stats')) body = {};
        else if (key.includes('preferences/me')) body = { deadlines: true, approvals: true, pettyCash: true, workflows: true, events: true, email: false, taskReminderHours: [24, 2] };
        else if (key.includes('intake-automation')) body = { enabled: false, rules: [], defaults: {} };
        else if (key.includes('/admin/email')) body = { configuration: { message: 'Synthetic test transport' }, enabled: false, webhookConfigured: false, queueErrors: 0, counts: [], recent: [] };
        else if (key.includes('unread-count')) body = { unread: 0 };
        await new Promise(resolve => setTimeout(resolve, 60));
        await route.fulfill({ json: body });
      });
      await page.goto(`${origin}/matters`);
      await page.locator('.app-shell-nav').waitFor();
      for (let i = 0; i < 100; i++) {
        const closed = page.locator('.app-shell-nav button[data-menu-path][aria-expanded="false"]').first();
        if (!await closed.count()) break;
        const group = await closed.getAttribute('data-menu-path');
        const start = Date.now();
        await closed.evaluate(button => button.click());
        if (!previous) menuGroups.push({ role, href: group, ms: Date.now() - start });
      }
      const targets = await page.locator('a[data-navigation-path]').evaluateAll(links => links.map(link => {
        const parents = [];
        for (let parent = link.parentElement; parent && !parent.matches('nav'); parent = parent.parentElement) {
          const toggle = parent.querySelector(':scope > button[data-menu-path]');
          if (toggle) parents.unshift(toggle.dataset.menuPath);
        }
        return { href: link.dataset.navigationPath, label: link.textContent.trim() || link.title, parents };
      }));
      console.log(`${role}: ${targets.length} rendered menu/submenu links`);
      for (const target of targets) {
        const auditKey = `${role}:${target.href}`;
        if (!target.href || audited.has(auditKey)) continue;
        audited.add(auditKey);
        currentTarget = target.href;
        try {
          for (const parent of target.parents) {
            const toggle = page.locator(`button[data-menu-path=${JSON.stringify(parent)}]`).first();
            if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.evaluate(button => button.click());
          }
          const link = page.locator(`a[data-navigation-path=${JSON.stringify(target.href)}]`).first();
          await link.evaluate(element => element.scrollIntoView({ block: 'center' }));
          await link.hover();
          await page.waitForTimeout(220); // Pointer intent starts preparation before the click.
          const start = Date.now();
          await link.click();
          await page.waitForFunction(() => {
            const main = document.querySelector('main');
            return main && main.innerText.trim().length > 0 && !/\bLoading(?:\s|\.|…)/i.test(main.innerText);
          }, undefined, { timeout: 8000 });
          const ms = Date.now() - start;
          const actual = new URL(page.url());
          // Preserve the staff router's existing creation permissions.
          const expected = new URL(role === 'associate' && target.href === '/matters/new' ? '/matters' : target.href, origin);
          assert.equal(actual.pathname + actual.search, expected.pathname + expected.search, 'Menu must open its corresponding destination');
          const text = await page.locator('main').innerText();
          assert(!/failed to (load|fetch)|unable to load|session expired/i.test(text), text.slice(0, 200));
          results.push({ role, ...target, ms, ...(expected.pathname !== new URL(target.href, origin).pathname ? { redirectedTo: expected.pathname } : {}) });
          if (results.length % 20 === 0) console.log(`PASS: ${results.length} menu destinations checked`);
        } catch (error) {
          failures.push({ role, href: target.href, error: error.message });
          console.error(`FAIL: ${target.href}: ${error.message}`);
          await page.goto(`${origin}/matters`);
          await page.locator('.app-shell-nav').waitFor();
        }
      }
      await page.close();
    }
    fs.mkdirSync(path.resolve(__dirname, '../../docs'), { recursive: true });
    fs.writeFileSync(auditPath, JSON.stringify({ apiDelayMs: 60, preparationMs: 220, menuGroups, destinations: results, failures }, null, 2) + '\n');
    const slower = results.filter(result => result.ms >= 1000);
    console.log(JSON.stringify({ destinations: results.length, groups: menuGroups.length, failures: failures.length, underOneSecond: results.length - slower.length, slow: slower.map(({ href, ms }) => ({ href, ms })) }));
    for (const failure of failures) console.error(JSON.stringify(failure));
    assert.equal(failures.length, 0, 'Every rendered menu destination must load without runtime errors');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
