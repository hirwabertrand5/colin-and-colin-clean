// UI verification uses intercepted test responses, never the application database.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = 'http://127.0.0.1:5178';
const output = path.resolve(__dirname, '../node_modules/.cache/ui-verification');
const user = { id: 'ui-user', name: 'Winnie Chen', email: 'winnie@test.invalid', role: 'associate' };
const initial = {
  _id: 'ui-task', title: 'Prepare and File Client Application Documents', taskNumber: 'ITK-2026-00156',
  description: 'Prepare and file the required client application documents for the property transfer. This task has been delegated while the original initiator is unavailable.',
  status: 'In Progress', priority: 'Medium', assignee: user.name, supervisor: 'Badiel Garcia', createdBy: user.name,
  relatedMatterId: 'ui-matter', relatedMatterLabel: 'MAT-2026-0018 · Smith Family Property Matter', relatedClient: 'John Smith',
  relatedMatter: { _id: 'ui-matter', caseNo: 'MAT-2026-0018', parties: 'Smith Family Property Matter', assignedTo: 'Richard Tan',
    caseAssignments: { initiator: 'Richard Tan', reviewer: 'Badiel Garcia', signerApprover: 'Sarah Lim' } },
  caseRole: 'Initiator', caseLifecycleStatus: 'Ready', keyActionKeys: ['application', 'filing'],
  startDate: '2026-10-25', dueDate: '2026-10-31T12:00:00.000Z', createdAt: '2026-10-25T08:24:00.000Z', updatedAt: '2026-10-26T10:00:00.000Z',
  caseWork: { role: 'Initiator', currency: 'RWF', lifecycleStatus: 'In Progress', tpaPercent: 3, timelinessScore: null, qualityScore: null,
    earnedFee: null, collectedBase: 0, performedKeyActions: 0, completedKeyActions: 0,
    selectedKeyActions: [
      { key: 'application', title: 'Prepare Client Application Form', stageTitle: 'Application Preparation', status: 'In Progress', dueAt: '2026-10-29T12:00:00.000Z', percentage: 10, originalResponsibleRole: 'Initiator', completed: false,
        instructions: ['Use the approved client application form.', 'Ensure client information is accurate.'], requirements: [{ name: 'Signed client application', required: true }], reviewHistory: [] },
      { key: 'filing', title: 'File Application with Authority', stageTitle: 'Filing & Submission', status: 'Not Started', dueAt: '2026-10-31T12:00:00.000Z', percentage: 5, originalResponsibleRole: 'Initiator', completed: false, instructions: [], requirements: [], reviewHistory: [] },
    ] },
};
async function main() {
  await fs.mkdir(output, { recursive: true });
  const options = { headless: true };
  if (!existsSync(chromium.executablePath())) options.channel = existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : 'msedge';
  const browser = await chromium.launch(options);
  const errors = [];
  const writes = [];
  let task = structuredClone(initial);
  let deleted = false;
  let comments = [{ _id: 'comment-1', taskId: task._id, authorName: user.name, body: 'I have completed the initial draft. Please review the attached document.', createdAt: '2026-10-26T08:05:00Z' }];
  const files = ['Client Application Form (Draft).pdf', 'Supporting Evidence.docx', 'Checklist - Application Filing.pdf'].map((name, i) => ({
    _id: 'file-' + i, taskId: task._id, fileName: name, originalName: name, fileSize: i ? '1.2 MB' : '245 KB', uploadedBy: user.name, uploadedDate: '2026-10-26', createdAt: '2026-10-26T08:00:00Z', url: '/uploads/ui-file-' + i,
  }));
  const page = await browser.newPage({ viewport: { width: 1820, height: 1150 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((actor) => { localStorage.setItem('user', JSON.stringify(actor)); localStorage.setItem('token', 'ui-test-only'); localStorage.setItem('theme', 'light'); }, user);
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (!['fetch', 'xhr'].includes(request.resourceType())) return route.continue();
    const url = new URL(request.url());
    const key = url.pathname;
    const method = request.method();
    if (method !== 'GET') writes.push({ key, method, body: request.postDataJSON() });
    let body = [];
    if (key.endsWith('/comments')) {
      if (method === 'POST') { const note = { _id: 'note-' + comments.length, ...request.postDataJSON(), taskId: task._id, authorName: user.name, createdAt: new Date().toISOString() }; comments.push(note); body = note; }
      else body = comments;
    } else if (key.endsWith('/attachments')) body = files;
    else if (key.endsWith('/history')) body = [{ _id: 'history-1', taskId: task._id, actorName: user.name, message: 'Task started', action: 'TASK_STATUS_CHANGED', detail: 'Assigned → In Progress', createdAt: '2026-10-26T08:00:00Z' }];
    else if (key.endsWith('/dashboard')) body = { summary: { totalTasks: deleted ? 0 : 1, openTasks: 1, inProgress: 1, awaitingReview: 0, awaitingExternalAction: 0, completed: 0, closed: 0, overdueTasks: 0, criticalTasks: 0 }, priorityDistribution: [], recentActivities: [], upcomingDeadlines: [], assignedToMe: [], tasksDueToday: [] };
    else if (key.endsWith('/independent-tasks/ui-task')) { if (method === 'DELETE') { deleted = true; body = { message: 'Task deleted.' }; } else body = task; }
    else if (key.includes('/independent-tasks/case-options/')) body = { keyActions: ['first', 'second', 'third'].map((key) => ({ key, title: key, status: 'Not Started', stageTitle: 'Delivery', eligibility: { Initiator: true } })) };
    else if (key.endsWith('/cases/independent-task-options')) body = [{ _id: 'ui-matter', caseNo: 'TEST-1', parties: 'Form test', status: 'In Progress' }];
    else if (key.endsWith('/independent-tasks')) body = method === 'POST' ? { ...task, ...request.postDataJSON() } : { items: deleted ? [] : [task], total: deleted ? 0 : 1, page: 1, limit: 20 };
    else if (key.includes('/users/')) body = [{ _id: 'ui-user', ...user, isActive: true }, { _id: 'ui-supervisor', name: 'Supervisor', email: 'supervisor@test.invalid', role: 'partner', isActive: true }];
    else if (key.includes('unread')) body = { count: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const visit = async () => { await page.goto(root + '/matters/independent-tasks/ui-task'); await page.locator('.it-page-header h1').waitFor(); };
  const assertNoOverflow = async () => {
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('body *')].filter((node) => {
        if (node.getBoundingClientRect().right <= innerWidth + 2) return false;
        for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowX)) return false;
        }
        return true;
      }).slice(0, 12).map((node) => ({ tag: node.tagName, class: node.className, width: node.getBoundingClientRect().width, right: node.getBoundingClientRect().right })) }));
    if (overflow.scroll > overflow.width + 1) overflow.containers = await page.evaluate(() => [...document.querySelectorAll('body, #root, body *')].filter((node) => node.scrollWidth > node.clientWidth + 3 && getComputedStyle(node).display !== 'inline').slice(0, 20).map((node) => ({ tag: node.tagName, class: node.className, client: node.clientWidth, scroll: node.scrollWidth, overflow: getComputedStyle(node).overflowX })));
    assert(overflow.scroll <= overflow.width + 1, 'Page overflow: ' + JSON.stringify(overflow));
  };
  const theme = async (dark) => {
    await page.evaluate((value) => { document.documentElement.classList.toggle('dark', value); document.documentElement.style.colorScheme = value ? 'dark' : 'light'; }, dark);
    await page.waitForTimeout(150);
  };
  try {
    await visit();
    assert(await page.locator('.it-header-actions').getByRole('button', { name: 'Delete Task', exact: true }).isVisible());
    assert.equal(await page.getByRole('heading', { name: 'Financial Summary (This Task)' }).count(), 1);
    assert.equal(await page.getByRole('tab', { name: 'Key Actions (2)' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Submit to Reviewer', exact: true }).count(), 1);
    await assertNoOverflow();
    await page.screenshot({ path: path.join(output, 'delegated-light.png'), fullPage: true });
    await theme(true);
    assert.equal(await page.locator('.it-card').first().evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(25, 38, 59)');
    const contrasts = await page.evaluate(() => {
      const luminance = (color) => {
        const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
        return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
      };
      return [...document.querySelectorAll('.it-workspace .it-badge, .it-workspace .it-primary')].map((node) => {
        const style = getComputedStyle(node); const foreground = luminance(style.color); const background = luminance(style.backgroundColor);
        return { text: node.textContent, ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
      });
    });
    for (const item of contrasts) assert(item.ratio >= 4.5, 'Insufficient dark contrast: ' + JSON.stringify(item));
    await page.screenshot({ path: path.join(output, 'delegated-dark.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Key Actions (2)' }).click();
    await page.getByRole('button', { name: 'Expand Prepare Client Application Form' }).click();
    assert(await page.getByText('Use the approved client application form.').isVisible());
    await page.getByRole('tab', { name: 'Documents (3)' }).click();
    assert(await page.getByRole('heading', { name: 'Upload Document' }).isVisible());
    await page.getByRole('tab', { name: 'Comments (1)' }).click();
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    assert(await page.getByRole('heading', { name: 'Reply to Comment' }).isVisible());
    await page.getByRole('tab', { name: 'Activity History' }).click();
    assert(await page.getByText('Task started', { exact: true }).isVisible());
    await page.getByRole('button', { name: 'Save Progress', exact: true }).click();
    await page.getByLabel('Work progress', { exact: true }).fill('Saved UI verification work note.');
    await page.locator('.it-work-editor').getByRole('button', { name: 'Save Progress' }).click();
    await page.getByText('Saved UI verification work note.').waitFor();
    assert(writes.some((entry) => entry.key.endsWith('/comments') && entry.body.body === 'Saved UI verification work note.'));
    console.log('PASS delegated layout, live actions, documents, comments/replies, activity, saved progress and dark contrast');

    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole('tab', { name: 'Overview', exact: true }).click();
      await page.screenshot({ path: path.join(output, 'delegated-' + width + '.png'), fullPage: true });
      await assertNoOverflow();
    }
    console.log('PASS tablet and mobile layout without page overflow');
    await page.setViewportSize({ width: 1820, height: 1150 });
    task = { ...structuredClone(initial), title: 'Prepare Internal Team Training', relatedMatterId: null, relatedMatter: null, relatedMatterLabel: undefined, relatedClient: undefined, caseRole: undefined, caseWork: undefined, keyActionKeys: [] };
    await visit();
    assert.equal(await page.getByRole('tab', { name: /Key Actions/ }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: /Financial Summary|Original Matter Team|Delegated Contributor/ }).count(), 0);
    assert.equal(await page.getByText('Linked Matter', { exact: true }).count(), 0);
    assert(await page.getByRole('button', { name: 'Request Review', exact: true }).isVisible());
    await theme(false);
    await page.screenshot({ path: path.join(output, 'standard-light.png'), fullPage: true });
    await theme(true);
    await page.screenshot({ path: path.join(output, 'standard-dark.png'), fullPage: true });
    console.log('PASS standalone task hides matter/delegation/financial sections and retains its normal workflow');

    task = { ...structuredClone(initial), createdBy: 'Another creator', createdByUserId: 'another-user', canDelete: true };
    await visit();
    assert(await page.locator('.it-header-actions').getByRole('button', { name: 'Delete Task', exact: true }).isVisible());
    task.canDelete = false;
    await visit();
    assert.equal(await page.getByRole('button', { name: 'Delete Task', exact: true }).count(), 0);
    console.log('PASS visible header Delete follows the server permission for creators and authorized senior members');

    task = { ...structuredClone(initial), status: 'Closed', caseWork: { ...initial.caseWork, lifecycleStatus: 'Ready' }, closedAt: '2026-10-26T10:00:00Z' };
    await visit();
    assert.equal(await page.locator('.it-header-meta').getByText('Closed', { exact: true }).count(), 1);
    assert.equal(await page.locator('.it-header-meta').getByText('Ready', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /Save Progress|Submit to Reviewer|Start Work/ }).count(), 0);
    await page.getByRole('tab', { name: 'Documents (3)' }).click();
    assert.equal(await page.getByRole('button', { name: 'Upload Document', exact: true }).count(), 0);
    console.log('PASS closed delegated task shows Closed rather than Ready and is read-only');

    task = { ...task, caseRole: undefined, relatedMatterId: null, relatedMatter: null, caseWork: undefined, title: 'Closed standalone deletion check' };
    await page.goto(root + '/matters/independent-tasks');
    const deleteButton = page.getByRole('button', { name: 'Delete ' + task.taskNumber, exact: true });
    await deleteButton.waitFor();
    for (const width of [1820, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const bounds = await deleteButton.boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, 'Delete must be visible without horizontal scrolling at width ' + width);
    }
    page.once('dialog', (dialog) => dialog.accept());
    await deleteButton.click();
    await page.waitForFunction(() => !document.querySelector('.independent-tasks-table')?.textContent.includes('Closed standalone deletion check'));
    assert(writes.some((entry) => entry.method === 'DELETE' && entry.key.endsWith('/independent-tasks/ui-task')));
    assert.deepEqual(errors, []);
    console.log('PASS closed standalone Delete button sends the existing API request and removes the row');
    await page.getByRole('button', { name: 'New Task', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const field = (label, control) => dialog.locator('label').filter({ hasText: new RegExp('^' + label + '$') }).locator('..').locator(control);
    await field('Title', 'input').fill('Multi action form verification');
    await field('Assignee', 'select').selectOption('ui-user');
    await field('Supervisor', 'select').selectOption('ui-supervisor');
    await field('Related Matter', 'select').selectOption('ui-matter');
    await dialog.getByRole('button', { name: 'Initiator', exact: true }).click();
    await dialog.getByRole('checkbox').first().waitFor();
    await dialog.getByRole('checkbox').nth(2).check();
    await dialog.getByRole('checkbox').nth(0).check();
    assert.equal(await dialog.getByRole('checkbox', { checked: true }).count(), 2);
    await dialog.getByRole('button', { name: 'Select all available', exact: true }).click();
    assert.equal(await dialog.getByRole('checkbox', { checked: true }).count(), 3);
    await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await dialog.getByRole('checkbox', { checked: true }).count(), 0);
    await dialog.getByRole('button', { name: 'Select all available', exact: true }).click();
    await field('Start Date', 'input').fill('2026-10-25');
    await field('Due Date', 'input').fill('2026-11-05');
    await dialog.getByRole('button', { name: 'Create Task', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const creation = writes.find((entry) => entry.method === 'POST' && entry.key.endsWith('/independent-tasks'));
    assert.equal(creation.body.assigneeUserId, 'ui-user');
    assert.equal(creation.body.supervisorUserId, 'ui-supervisor');
    assert.deepEqual(creation.body.keyActionKeys, ['first', 'second', 'third']);
    console.log('PASS form selects multiple Key Actions, selects all/clears, and submits stable assignee and supervisor account IDs');
    console.log('UI verification passed. Screenshots: ' + output);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
