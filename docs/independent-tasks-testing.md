# Delegated Independent Tasks: how it works and how to test

Delegated Independent Tasks operate on a matter's existing Key Actions. They do
not change its permanent Initiator, Reviewer, or Signer/Approver assignments.
Standard Independent Tasks keep their existing lifecycle.

All active staff, including interns and trainee associates, can select matter
Key Actions and create delegated Initiator tasks. Reviewer and Signer/Approver
tasks still require an authorized creator and an assignee with review privileges.
Creating initiator work does not grant case workspace or management access.

## Before testing in the application

1. Use a test matter and test accounts. These instructions create real records
   in whichever application environment you open.
2. Start the updated backend and frontend in separate terminals:

   ```powershell
   # Terminal 1, from the repository root
   cd colin-backend
   npm.cmd run dev
   ```

   ```powershell
   # Terminal 2, from the repository root
   npm.cmd run dev
   ```

3. The backend needs its usual environment configuration and a MongoDB replica
   set (Atlas is suitable). Delegated claims and correction returns use transactions.
4. Prepare an active test matter with a workflow and three distinct permanent
   assignees. Also prepare an authorized substitute who is not one of those assignees.
5. Select any number of unreserved **Not Started** Key Actions, or use **Select
   all available**. There is no selection limit, but selections must follow
   workflow order starting with the first available action. Skipping an earlier
   action is rejected. Deselecting an earlier action clears later selections.
   Actions reserved by another task stay unavailable. Reviewers and approvers
   select only actions awaiting their respective lifecycle stage.
6. For positive earned-fee testing, configure the matter's contract/budget,
   Key Action percentages and deadlines, an authorized quality score, and a paid
   invoice. Missing scores remain pending; a submission alone is not realized income.

## Test 1: delegated initiator, corrections and final approval

### Self-assignment and senior assignment

1. Sign in as Winnie. Create a task, select Winnie as assignee and an active
   non-intern supervisor, then select a matter and **Initiator**.
2. Check several available Key Actions. The selected count should increase
   for each checkbox. Test **Select all available** and **Clear** too.
3. Create the task, open it, start work and submit to the reviewer. Every
   selected action should reach **Awaiting Review**, with Winnie as contributor.
4. Sign in as a Managing Director or Managing Partner and repeat creation on
   another matter, assigning Winnie. Winnie should see it in her task list and
   dashboard and be able to start and submit it herself.
5. An inactive assignee must be rejected with an explicit inactive-account
   message. Interns and trainees must not be able to perform review/approval.

### Full lifecycle

1. Sign in as the substitute. Open **Independent Tasks**, then its create form.
2. Enable **Delegated Case Work**, select the test matter, choose **Initiator**,
   and select an eligible Key Action. Fill in the required task information.
3. Save. Open the task by clicking its row or **Open**.
4. Click **Start Work**. The actual Key Action should become
   **In Progress** in Case Management too.
5. Add work notes under **Comments**, and upload a supporting file under
   **Documents**. The matter's **Documents** and **Case Management** document
   sections should show the same shared upload.
6. Click **Submit to Reviewer**. Both interfaces should show **Awaiting Review**.
   The task must not be completed or approved yet.
7. Sign in as the matter's permanent reviewer. Open **Case Management** and
   click **Return for corrections** on that action. Enter feedback and submit.
8. Return to the substitute's Independent Task and refresh it. It should show
   **Changes Requested**, the reviewer's feedback, and the returned action.
9. Add the corrected document/notes and click **Resubmit to Reviewer**. The
   action returns to **Awaiting Review**. Expand **Review history** to see both
   the return and resubmission, including who acted and when.
10. As the reviewer, click **Send to Signer / Approver**. The action should show
    **Awaiting Approval**.
11. As the permanent approver, click **Approve & Complete**. The action becomes
    **Completed**; the linked submitted Independent Task also becomes completed.
12. Verify the permanent assignments are unchanged. Check the earned-fee tables
    in **Overview** and **Case Management**, the Independent Task summary, and
    the contributor dashboard. The substitute should appear as a delegated
    contributor. The original initiator must not also receive the same allocation.

## Test 2: substitute reviewer and approver

1. Submit an action for review as in Test 1.
2. As an authorized substitute reviewer, create a delegated task on the same
   matter with role **Reviewer**. Select the action awaiting review.
3. Open the task and click **Start Work**. Use **Return for corrections**
   to test a return, or **Submit to Signer / Approver** to forward reviewed work.
4. After forwarding, an authorized substitute approver can create a delegated
   task with role **Signer/Approver** and select the pending-approval action.
5. Start that task. Return it with feedback, or click **Approve & Complete**.
6. If the approver returns it, the initiator must correct and resubmit it, and
   the reviewer must forward it again before approval is allowed. The existing
   reviewer/approver tasks can process their eligible actions again.
7. Confirm both substitutes appear under their actual acting roles, with their
   individual contributions, while permanent assignments remain unchanged.

## Additional checks

- **Multiple actions:** return one action while another is already approved.
  Resubmitting corrections must not reopen the approved action. The task remains
  pending until all its actions have final approval.
- **Eligibility:** started, completed and reserved actions cannot be newly claimed.
  Reviewers see pending-review work; approvers see pending-approval work.
- **Concurrent claim:** in two accounts, select the same eligible action before
  either saves. Save both tasks. Only one exclusive claim should succeed.
- **Authorization:** unrelated users cannot return work. A contributor cannot
  review or approve their own work, even through another delegated task.
- **Unstarted deletion:** the creator can delete an untouched task. Its reservation
  is released, and the action becomes claimable again.
- **Started/submitted cancellation:** deletion becomes cancellation. Repeating
  deletion on an unsubmitted cancelled task permanently removes its private
  records and releases reservations. If submission or financial contribution
  exists, cancellation preserves review history, attribution and shared matter documents.
- **Shared attachment removal:** removing a task attachment must leave the shared
  matter document and its downloadable file available.
- **Standard tasks:** create a task without delegation and run its ordinary
  acknowledge/start/review/complete flow. Its workspace must hide delegated
  Key Actions, the original matter team and delegated financial panels. The
  creator can also delete a closed standard task from the list's Actions
  column; private comments, history, notifications, audit links and files are
  removed without touching another task with the same title.
- **Delete visibility:** the task creator and authorized senior members see a
  red **Delete Task** button in the workspace header and **Delete** in the list's
  pinned Actions column. Senior deletion roles include Managing Partner,
  Executive Assistant, Senior Executive Assistant, the partner/director roles,
  Originating Attorney and Senior Associate. Ordinary non-creators cannot delete
  another person's task. The API's permission determines button visibility.

## Automated database verification

From `colin-backend`:

```powershell
npm.cmd run verify:independent-tasks
npm.cmd run build
```

From the repository root:

```powershell
npm.cmd run build
```

The verification command starts a disposable local MongoDB replica set and a
temporary API server. It creates its own users, matters, invoices and uploads,
then shuts them down. It never reads `MONGO_URI` or connects to the application
database. The first run needs an official MongoDB test binary. On Windows, the
optional `node scripts/downloadTestMongo.cjs` helper downloads only the executable
from the official archive and verifies its ZIP checksum; subsequent runs reuse it.

Changes in your working tree must be deployed before they are available on a
hosted site. These checks do not deploy the application.
