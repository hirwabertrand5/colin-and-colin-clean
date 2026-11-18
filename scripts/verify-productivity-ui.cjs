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
    for (const label of ['Firm Overview', 'Financial Summary', 'Case Analytics', 'Client Profitability', 'Staff Revenue Attribution', 'Staff Profitability']) {
      await page.getByRole('navigation', { name: 'Report tabs' }).getByRole('button', { name: label, exact: true }).click();
      assert(await page.getByLabel('Reporting period').isVisible());
      assert(await page.getByLabel('Team member').isVisible());
    }
    assert.deepEqual(errors, []);
    console.log('PASS: default fees and detail match the dashboard; earlier completions funded in-period are included; completed-work valuation stays separate; desktop/mobile, filters, links and both Excel views.');
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
