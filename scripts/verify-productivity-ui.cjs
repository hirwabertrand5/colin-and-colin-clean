// Browser verification uses synthetic responses only; no production API or database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../colin-backend/node_modules/playwright');
const ExcelJS = require('exceljs');

async function main() {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 4178, strictPort: true, open: false } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const user = { id: 'test-user', _id: 'test-user', name: 'Report Reviewer', email: 'reviewer@test.invalid', role: 'managing_director' };
    await page.addInitScript(user => { localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('token', 'synthetic-test-token'); }, user);
    const rows = Array.from({ length: 12 }, (_, index) => ({
      id: `row-${index}`, caseId: String(index + 1).padStart(24, '0'), keyActionKey: `action-${index}`,
      staff: 'Ada', assignmentRole: 'Initiator', role: 'associate', matter: index === 0 ? 'Acme & Partners' : `MAT-${index}`,
      matterReference: index === 0 ? 'Acme & Partners' : `MAT-${index}`, task: `Action ${index}`, workflowStage: 'Delivery', keyActionPercent: 5,
      completedAt: '2026-11-10T10:00:00Z', taskFee: index < 2 ? 0 : 10000, taskFeeCollected: index < 2 ? 0 : 10000,
      tpaPercent: 5, timelinessScore: 80, qualityScore: index === 1 ? null : 90,
      feeEarned: index === 1 ? null : index < 2 ? 0 : 360.25, formula: 'Base × TPA × Timeliness × Quality',
      contractValue: 200000, collectedAmount: index < 2 ? 0 : 100000, allocationStatus: index < 2 ? 'No Paid invoices linked to matter' : 'Allocated',
      qualitySource: index === 1 ? 'Awaiting quality review' : 'Case Management quality review',
      timelinessStatus: 'On track',
      issues: index === 1 ? ['Quality score pending'] : [],
    }));
    const report = {
      range: { from: '2026-10-17', to: '2026-11-17' }, dateBasis: 'invoiceDate', selectedMember: null,
      kpis: {}, ageingReport: [], months: [], caseTypes: [], clientProfitability: [], team: [],
      productivityRows: rows, productivitySummary: { completedTasks: 1, keyActionsCompleted: 12, contributionRecords: 12,
        totalTaskFeeCollected: 100000, totalTaskFee: 100000, totalFeeEarned: 12658.51, completedWorkFeeValue: 40198.11, pendingFeeRecords: 0,
        completedWorkCollectedBase: 100000, completedWorkPendingFeeRecords: 1,
        averageQualityScore: 90, averageTimelinessScore: 80,
        pendingQualityScores: 1, pendingTimelinessScores: 0, zeroAllocationActions: 2, missingMatterReferences: 0 },
      productivityEarningsRows: [
        { ...rows[2], completedAt: '2026-10-10T10:00:00Z', feeEarned: 8000.25 },
        { ...rows[3], feeEarned: 4658.26 },
      ],
      productivityEarningsSummary: { contributionRecords: 2, pendingFeeRecords: 0 },
      productivityReconciliation: { timeZone: 'Africa/Kigali', activityBasis: 'Key Action completion date',
        collectionBasis: 'All-time Paid invoices linked by matter ID; values reflect current collections and scores',
        dashboardFeeBasis: 'Paid invoice payment date (paidAt; updatedAt for legacy invoices)',
        allTime: { keyActionsChecked: 708, sectionsCompleted: 110, feesEarned: 237068, pendingFeeRecords: 3 },
        selectedPeriod: { keyActionsChecked: 15, sectionsCompleted: 2, feesEarned: 12658.51, pendingFeeRecords: 1 },
        allTimeContributionRecords: 20, outsidePeriodContributionRecords: 7, undatedContributionRecords: 1 },
    };
    await page.route('**/*', async route => {
      if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
      assert.equal(route.request().method(), 'GET');
      const key = new URL(route.request().url()).pathname;
      let body = [];
      if (key.endsWith('/reports/firm')) body = report;
      else if (key.endsWith('/users/staff')) body = [{ ...user, name: 'Ada' }];
      else if (key.includes('/auth/me')) body = user;
      else if (key.includes('/notifications/unread-count')) body = { count: 0 };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('http://127.0.0.1:4178/reports');
    await page.getByRole('button', { name: 'Productivity Report', exact: true }).click();
    await page.getByRole('heading', { name: 'Productivity', exact: true }).waitFor();
    assert.equal(await page.locator('.fr-metrics').getByText('15', { exact: true }).count(), 1);
    assert(await page.locator('.fr-metrics').getByText('RWF 12,658.51', { exact: true }).isVisible(), 'Headline matches dashboard payment-period earnings');
    assert.equal(await page.getByText('RWF 40,198.11', { exact: true }).count(), 0, 'Completed-work value is not a competing headline');
    assert(await page.getByLabel('Earnings detail total').getByText('RWF 12,658.51', { exact: true }).isVisible());
    assert(await page.getByText('2 of 2 records', { exact: true }).isVisible());
    const records = page.getByLabel('Productivity records');
    const expectedColumns = ['#', 'Date / Time', 'Staff', 'Matter', 'Key Action', 'Collected Key Action Base', 'TPA', 'Timeliness Score', 'Quality Score', 'Formula', 'Fee Earned', 'Allocation / Review Status'];
    for (const name of expectedColumns) assert.equal(await records.getByRole('columnheader', { name, exact: true }).count(), 1, `Retains column: ${name}`);
    const metricValues = await page.getByLabel('Work and review summary').locator('dd').allTextContents();
    assert.deepEqual(metricValues, ['12', '2', '12', '2', '1', '0', '0', '90%', '80%', '0'], 'Restores all summary metrics');
    assert(await page.getByRole('heading', { name: 'Dashboard Summary', exact: true }).isVisible());
    assert(await page.getByLabel('Contribution reconciliation').getByText('Missing Completion Date', { exact: false }).isVisible());
    await page.getByLabel('Calculation sources').getByText('Sources & calculation', { exact: true }).click();
    assert(await page.getByLabel('Calculation sources').getByText('Case Management', { exact: true }).isVisible());
    const paymentDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export report', exact: true }).click();
    const paymentWorkbook = new ExcelJS.Workbook();
    await paymentWorkbook.xlsx.readFile(await (await paymentDownloadPromise).path());
    const paymentValues = paymentWorkbook.worksheets.flatMap(sheet => sheet.getSheetValues()).flat(2).map(value => String(value ?? ''));
    assert(paymentValues.some(value => value.includes('KEY ACTION PRODUCTIVITY METRICS') && value.includes('PAYMENT DATE')));
    assert(paymentValues.includes('RWF 12,658.51'));
    assert(paymentValues.includes('8000.25') && paymentValues.includes('4658.26'));
    await page.getByRole('group', { name: 'Productivity detail view' }).getByRole('button', { name: 'Key Actions Completed', exact: true }).click();
    assert(await page.getByLabel('Completed-work valuation').getByText('RWF 40,198.11', { exact: true }).isVisible());
    assert.equal(await page.locator('select').filter({ has: page.locator('option[value="invoiceDate"]') }).count(), 0, 'Unrelated invoice date selector hidden');
    await page.getByLabel('Filter productivity issues').selectOption('quality');
    assert(await page.getByText('1 of 12 records', { exact: true }).isVisible());
    await page.getByLabel('Filter productivity issues').selectOption('all');
    assert.equal(await page.getByRole('link', { name: 'Acme & Partners', exact: true }).getAttribute('href'), '/cases/000000000000000000000001?tab=case-management&step=action-0');
    assert(await records.locator('.fr-formula').first().isVisible(), 'Formula remains directly visible');
    assert(await records.getByText('On track', { exact: true }).first().isVisible(), 'Timeliness status retained');
    await page.getByLabel('Filter productivity issues').selectOption('reference');
    assert(await page.getByText('0 of 12 records', { exact: true }).isVisible(), 'Transactional parties are not flagged as missing references');
    await page.getByLabel('Filter productivity issues').selectOption('all');
    await records.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(await records.locator('tbody tr').first().locator('td').first().textContent(), '11', 'Row numbering continues on the next page');
    await records.getByRole('button', { name: 'Previous', exact: true }).click();
    await records.getByRole('columnheader', { name: 'Matter', exact: true }).click();
    await records.getByRole('columnheader', { name: 'Matter', exact: true }).click();
    assert.equal(await records.locator('tbody tr').first().getByRole('link').first().textContent(), 'MAT-9', 'Matter sorting still reorders all records');
    await records.getByRole('columnheader', { name: 'Date / Time', exact: true }).click();
    await page.getByLabel('Search productivity records').fill('MAT-11');
    assert(await page.getByText('1 of 12 records', { exact: true }).isVisible());
    await page.getByLabel('Search productivity records').fill('');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export report', exact: true }).click();
    const download = await downloadPromise;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(await download.path());
    const values = workbook.worksheets.flatMap(sheet => sheet.getSheetValues()).flat(2).map(value => String(value ?? ''));
    assert(values.includes('DASHBOARD RECONCILIATION'));
    assert(values.some(value => value.includes('KEY ACTION PRODUCTIVITY METRICS') && value.includes('TASK COMPLETION DATE')));
    assert(values.includes('Quality score pending'));
    assert(values.includes('Key Action completion date'));
    assert(values.includes('Matter ID'));
    const feeCells = [];
    workbook.worksheets.forEach(sheet => sheet.eachRow(row => row.eachCell(cell => { if (cell.value === 360.25) feeCells.push(cell); })));
    assert(feeCells.some(cell => cell.numFmt === 'RWF #,##0.00'), 'Export retains fee decimals');
    const output = path.resolve(__dirname, '../node_modules/.cache/productivity-ui');
    fs.mkdirSync(output, { recursive: true });
    await page.getByLabel('Productivity summary').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.app-shell-sidebar').getBoundingClientRect().right <= 0);
    await page.getByLabel('Productivity summary').scrollIntoViewIfNeeded();
    assert(await page.getByRole('heading', { name: 'Productivity', exact: true }).isVisible());
    await page.getByLabel('Filter productivity issues').selectOption('zero');
    assert(await page.getByText('2 of 12 records', { exact: true }).isVisible());
    await page.getByLabel('Productivity summary').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel('Filter productivity issues').selectOption('all');
    await records.getByRole('columnheader', { name: 'Matter', exact: true }).click();
    const firmRecordOrder = await records.locator('tbody tr').allTextContents();
    const firmPdfPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    assert(fs.readFileSync(await (await firmPdfPromise).path()).toString('latin1').startsWith('%PDF-'));
    for (const label of ['Firm Overview', 'Financial Summary', 'Case Analytics', 'Client Profitability', 'Staff Revenue Attribution', 'Staff Profitability']) {
      await page.getByRole('navigation', { name: 'Report tabs' }).getByRole('button', { name: label, exact: true }).click();
      assert(await page.getByLabel('Reporting period').isVisible());
      assert(await page.getByLabel('Team member').isVisible());
    }
    console.log('PASS: management report, filters, sorting, Excel and PDF.');

    const staffPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    staffPage.on('pageerror', error => errors.push(error.message));
    const staffUser = { ...user, name: 'Ada', role: 'associate' };
    await staffPage.addInitScript(actor => { localStorage.setItem('user', JSON.stringify(actor)); localStorage.setItem('token', 'synthetic-staff-token'); }, staffUser);
    const personalRequests = [];
    let failReport = false;
    const personalReport = params => {
      const result = structuredClone(report);
      result.selectedMember = { name: 'Ada', role: 'associate', feesEarned: 12658.51 };
      result.dateBasis = 'paymentDate';
      if (params.get('range') === 'all') {
        result.range = { from: '0001-01-01', to: '9999-12-31' };
        result.productivityReconciliation.selectedPeriod = { ...result.productivityReconciliation.allTime };
        result.productivitySummary.totalFeeEarned = 237068;
        result.productivityEarningsRows[0].feeEarned = 200000.25;
        result.productivityEarningsRows[1].feeEarned = 37067.75;
      } else if (params.get('from')) {
        result.range = { from: params.get('from'), to: params.get('to') };
      } else if (params.get('range') === 'daily') {
        result.productivityRows = []; result.productivityEarningsRows = [];
        result.productivityReconciliation.selectedPeriod.feesEarned = 0;
        result.productivitySummary.totalFeeEarned = 0;
      } else if (params.get('range') === 'weekly') {
        result.productivityEarningsRows = [{ ...rows[1] }];
        result.productivityReconciliation.selectedPeriod.feesEarned = null;
        result.productivitySummary.totalFeeEarned = null;
      }
      return result;
    };
    const dashboardSummary = params => {
      if (!params.get('range') && !params.get('from')) params = new URLSearchParams('range=all');
      const result = personalReport(params);
      return { user: { name: 'Ada' }, currency: 'RWF', tpaPercent: 5, mattersAssigned: 0,
        mattersCompleted: 0, mattersOutstanding: 0, overdueSections: 0,
        feesEarnedTotal: 237068, collectedBaseTotal: 100000, rows: [], workByMatter: {},
        period: { key: params.get('range') || 'custom', label: 'Selected period',
          from: result.range.from, to: result.range.to, isAllTime: params.get('range') === 'all',
          feesEarned: result.productivityReconciliation.selectedPeriod.feesEarned,
          keyActionsChecked: 15, sectionsCompleted: 2, contractValue: 0, tasksOutstanding: 0,
          tasksCompleted: 0, mattersCompleted: 0, mattersWithActivity: 0 } };
    };
    await staffPage.route('**/*', async route => {
      if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
      assert.equal(route.request().method(), 'GET');
      const url = new URL(route.request().url()), key = url.pathname;
      assert(!key.endsWith('/reports/firm') && !key.endsWith('/users/staff'), 'Staff report never requests firm-wide or staff directory data');
      if (key.endsWith('/dashboard/bootstrap')) {
        const sections = { tasks: [], cases: [], events: [], performance: null, summary: dashboardSummary(new URLSearchParams('range=all')),
          prospects: [], independent: { items: [] }, audit: { items: [], total: 0, pages: 1, page: 1 } };
        return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: Object.entries(sections).map(([section, value]) => JSON.stringify({ section, status: 'fulfilled', value })).join('\n') + '\n' });
      }
      if (key.endsWith('/reports/my-productivity')) {
        personalRequests.push(url.searchParams.toString());
        if (url.searchParams.get('range') === 'yearly') await new Promise(resolve => setTimeout(resolve, 500));
        return route.fulfill({ status: failReport ? 500 : 200, contentType: 'application/json', body: JSON.stringify(failReport ? { message: 'Synthetic report failure' } : personalReport(url.searchParams)) });
      }
      let body = [];
      if (key.endsWith('/dashboard/staff-summary')) body = dashboardSummary(url.searchParams);
      else if (key.includes('/auth/me')) body = staffUser;
      else if (key.includes('/audit/my')) body = { items: [], total: 0, pages: 1, page: 1 };
      else if (key.includes('/notifications/unread-count')) body = { count: 0 };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await staffPage.goto('http://127.0.0.1:4178/');
    const tabs = staffPage.getByRole('tablist', { name: 'My Financial Contribution' });
    await tabs.getByRole('tab', { name: 'Financial Contribution', exact: true }).waitFor();
    assert.equal(personalRequests.length, 0, 'Report loads on demand');
    await tabs.getByRole('tab', { name: 'Productivity Report', exact: true }).click();
    const personal = staffPage.getByLabel('My productivity report');
    await personal.getByRole('heading', { name: 'Productivity', exact: true }).waitFor();
    assert.equal(new URLSearchParams(personalRequests.at(-1)).get('range'), 'all', 'All time is explicit rather than the endpoint monthly default');
    assert(await personal.locator('.fr-metrics').getByText('RWF 237,068.00', { exact: true }).isVisible());
    await staffPage.getByLabel('Reporting period', { exact: true }).selectOption('monthly');
    await personal.locator('.fr-metrics').getByText('RWF 12,658.51', { exact: true }).waitFor();
    assert(await personal.getByLabel('Earnings detail total').getByText('RWF 12,658.51', { exact: true }).isVisible());
    const staffExcelPromise = staffPage.waitForEvent('download');
    await personal.getByRole('button', { name: 'Excel', exact: true }).click();
    const staffWorkbook = new ExcelJS.Workbook();
    await staffWorkbook.xlsx.readFile(await (await staffExcelPromise).path());
    assert.deepEqual(staffWorkbook.worksheets[0].getSheetValues().filter(row => row?.[2] === 'Action completed').length, 1);
    const staffValues = staffWorkbook.worksheets.flatMap(sheet => sheet.getSheetValues()).flat(2).map(value => String(value ?? ''));
    assert(staffValues.includes('8000.25') && staffValues.includes('4658.26'));
    const staffPdfPromise = staffPage.waitForEvent('download');
    await personal.getByRole('button', { name: 'PDF', exact: true }).click();
    const staffPdf = fs.readFileSync(await (await staffPdfPromise).path()).toString('latin1');
    assert(staffPdf.startsWith('%PDF-') && staffPdf.includes('12,658.51'), 'PDF includes exact period earnings');
    console.log('PASS: staff all-time/monthly values, Excel and PDF.');

    await personal.getByRole('group', { name: 'Productivity detail view' }).getByRole('button', { name: 'Key Actions Completed', exact: true }).click();
    const staffRecords = personal.getByLabel('Productivity records');
    await staffRecords.getByRole('columnheader', { name: 'Matter', exact: true }).click();
    assert.deepEqual(await staffRecords.locator('tbody tr').allTextContents(), firmRecordOrder, 'Personal and firm reports show the same values and sorted rows');
    await staffRecords.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(await staffRecords.locator('tbody tr').first().locator('td').first().textContent(), '11');
    await personal.getByLabel('Filter productivity issues').selectOption('quality');
    assert(await personal.getByText('1 of 12 records', { exact: true }).isVisible());
    await personal.getByLabel('Filter productivity issues').selectOption('all');
    await staffRecords.getByRole('columnheader', { name: 'Fee Earned', exact: true }).click();
    await staffRecords.getByRole('columnheader', { name: 'Fee Earned', exact: true }).click();
    const allRowsPromise = staffPage.waitForEvent('download');
    await personal.getByRole('button', { name: 'Excel', exact: true }).click();
    const allWorkbook = new ExcelJS.Workbook();
    await allWorkbook.xlsx.readFile(await (await allRowsPromise).path());
    const exportedRows = allWorkbook.worksheets[0].getSheetValues().filter(row => /^Action \d+$/.test(String(row?.[5])));
    assert.equal(exportedRows.length, 12, 'Exports every matching record across pages');
    assert.equal(exportedRows[0][11], 360.25, 'Exports numeric fee sort order');
    assert.equal(exportedRows.at(-1)[11], 'Pending', 'Preserves pending fee rather than converting it to zero');
    await personal.getByLabel('Search productivity records').fill('MAT-11');
    assert(await personal.getByText('1 of 12 records', { exact: true }).isVisible());
    await personal.getByLabel('Search productivity records').fill('');
    await staffPage.setViewportSize({ width: 390, height: 844 });
    await staffPage.waitForFunction(() => document.querySelector('.app-shell-sidebar').getBoundingClientRect().right <= 0);
    await personal.locator('.fr-metrics').scrollIntoViewIfNeeded();
    assert(await staffPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Wide report tables scroll inside the mobile page');
    assert(await personal.getByRole('button', { name: 'Excel', exact: true }).isVisible());
    await staffPage.screenshot({ path: path.join(output, 'staff-mobile.png') });
    await staffPage.setViewportSize({ width: 1440, height: 1000 });
    console.log('PASS: staff/management row parity, search, issue filters, pagination, complete sorted exports and mobile layout.');

    const periodSelect = staffPage.getByLabel('Reporting period', { exact: true });
    const requestsBeforeCustom = personalRequests.length;
    await periodSelect.selectOption('custom');
    await staffPage.getByLabel('From', { exact: true }).fill('2026-11-01');
    await staffPage.getByRole('button', { name: 'Apply range', exact: true }).click();
    assert(await staffPage.getByText('Select both a From and a To date to apply the custom range.', { exact: true }).isVisible());
    assert.equal(personalRequests.length, requestsBeforeCustom, 'Unapplied custom dates do not fetch another report');
    await staffPage.getByLabel('To', { exact: true }).fill('2026-11-12');
    await staffPage.getByRole('button', { name: 'Apply range', exact: true }).click();
    await personal.getByText('2026-11-01 to 2026-11-12', { exact: true }).waitFor();
    assert.equal(new URLSearchParams(personalRequests.at(-1)).get('from'), '2026-11-01');
    const requestsBeforeRefresh = personalRequests.length;
    await staffPage.getByRole('button', { name: 'Refresh', exact: true }).first().click();
    await staffPage.waitForFunction(() => document.querySelector('[aria-label="My productivity report"]')?.getAttribute('aria-busy') === 'false');
    assert(personalRequests.length > requestsBeforeRefresh, 'Dashboard refresh reloads the personal report');
    await periodSelect.selectOption('daily');
    await personal.getByText('No matching records.', { exact: true }).waitFor();
    await periodSelect.selectOption('weekly');
    await personal.getByRole('group', { name: 'Productivity detail view' }).getByRole('button', { name: 'Fees Earned', exact: true }).click();
    await personal.getByLabel('Earnings detail total').getByText('Pending', { exact: true }).waitFor();
    failReport = true;
    await periodSelect.selectOption('quarterly');
    await personal.getByRole('alert').getByText('Synthetic report failure', { exact: true }).waitFor();
    assert(await personal.getByRole('button', { name: 'Excel', exact: true }).isDisabled(), 'Failure cannot export stale data');
    failReport = false;
    await personal.getByRole('button', { name: 'Refresh productivity report' }).click();
    await personal.getByRole('heading', { name: 'Productivity', exact: true }).waitFor();
    await periodSelect.selectOption('yearly');
    await periodSelect.selectOption('all');
    await personal.locator('.fr-metrics').getByText('RWF 237,068.00', { exact: true }).waitFor();
    await new Promise(resolve => setTimeout(resolve, 650));
    assert(await personal.locator('.fr-metrics').getByText('RWF 237,068.00', { exact: true }).isVisible(), 'Older requests cannot replace the active period');
    await tabs.getByRole('tab', { name: 'Financial Contribution', exact: true }).click();
    await staffPage.getByText('Fee breakdown by matter (Case Workspace)', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: firm and staff report parity; period and custom filters; search, numeric sorting and pagination; Excel/PDF; pending/empty/error/refresh/stale requests; desktop/mobile; personal-only API access.');
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
