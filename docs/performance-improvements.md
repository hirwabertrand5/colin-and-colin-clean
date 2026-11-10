# Loading and response-time improvements

10 November 2026. Changes are implemented in the local checkout; production deployment and production timing measurements have not been performed.

## Measured improvements

| Area | Result |
| --- | --- |
| Login JavaScript download | Approximately 1,058 KB compressed before, 90 KB after: **91% smaller**. |
| Login button feedback | 66 ms in the final browser run. |
| Send to Reviewer feedback | 56–71 ms. |
| Send to Signer / Approver feedback | 46–54 ms. |
| Approve & Complete feedback | 50–738 ms. |
| Tick a Key Action feedback | 38–43 ms. |
| Untick/reopen feedback | 46 ms. |

Button measurements include successful and rejected saves. The browser tests deliberately delayed API responses by 1.2 seconds. These figures measure the immediate visible response; the database save still has to finish before the action is confirmed. A rejected save restores the previous state and displays the error.

The final real HTTP test against disposable local MongoDB also completed all measured requests below one second, including database saves and accounting hooks:

| Request | Final local completion | Database operations before → after |
| --- | --- | --- |
| Login | 153 ms | 1 → 1 |
| Case Management load | 36 ms | 8 → 8, with independent reads running together |
| Tick Key Action | 303 ms | 76 → 22 |
| Submit to Reviewer | 370 ms | 53 → 26 |
| Submit to Approver | 235 ms | 53 → 26 |
| Approve Key Action | 268 ms | 99 → 32 |

These are individual local measurements using a synthetic matter with ten Key Actions, eight already approved. They are not production benchmarks or a guaranteed response-time limit. Database operation counts provide the more stable comparison across runs.

## What was made faster

- **Login and initial loading:** staff pages and public forms load on demand. Login no longer downloads every dashboard, workspace, report, billing screen, chart, or export library. Authentication reads only the required account fields and retains the existing password verification and account checks.
- **Case Workspace:** ticks immediately freeze the visible deadline clock. Unticking also updates immediately. Concurrent workflow/template reads share one request, and successful workflow actions reuse the saved workflow returned by the API. This removes an extra workflow download after ticking, reopening, amending deadlines, and adding, editing, or deleting actions.
- **Case Management:** reviewer submissions, approver submissions, and approvals update immediately, show that saving is in progress, and prevent conflicting submissions while saving. Independent context reads run together.
- **Database work:** earnings snapshots read existing ledger entries in one batch. Workflow operations that immediately save case progress calculate the final earnings snapshot once after both records are saved. Activity-time rates, financial persistence, workflow order, role permissions, and audit writes remain in place. Operations within MongoDB transactions remain sequential.
- **Notifications:** review/approval actions persist in-app alerts before responding. Email preparation uses the existing durable pending queue and delivery worker, which runs every 10 seconds, including recovery after a restart.
- **Other pages and exports:** each staff screen downloads when opened. Excel and PDF libraries download when an export is requested, reducing loading across ordinary page visits.

## Verification

- Production frontend build passed.
- Backend TypeScript validation passed.
- Real HTTP integration checks passed for sequence, role permissions, review/approval, case closure, workflow reopening, immediate and idempotent earnings persistence, durable email processing, account-history preservation during login, and immediate account deactivation.
- All 14 financial integration scenarios passed, including historical rates, payment limits, and rollback.
- All 43 notification regression groups passed using mocked email transport.
- All 28 workflow progress/order checks passed.
- Browser checks passed for immediate feedback, rollback, duplicate-read removal, and runtime errors.
- Excel and PDF exports produced files with valid XLSX/PDF signatures after loading their libraries on demand.
- Request-sharing checks passed for concurrent reads, fresh reads, failure recovery, and separate account keys.

Verification uses disposable local databases, synthetic accounts, and intercepted browser API responses. No production records were modified. One existing notification test fixture was corrected to set its immutable creation timestamp directly in the disposable database, making its daily digest check independent of the current date.

The changes improve responsiveness and reduce downloads and database work. An end-to-end guarantee below one second still needs measurement after deploying both frontend and backend, because production network latency, database latency, and server startup time are outside these local measurements.

An existing lifecycle inconsistency was observed: reopening a workflow step on an already closed matter reactivates the step but leaves the matter marked Closed. Its terminal-state rule was preserved in this performance update.

## Reproduce the checks

From the project root:

```text
npm run build
node scripts/verifySharedRequest.mjs
```

From `colin-backend`:

```text
npm run build
npm run verify:response-performance
npm run verify:notifications
node node_modules/tsx/dist/cli.mjs src/scripts/verifyTpaIntegration.ts
npm run verify:progress-and-order
```

For browser checks, serve the production build on `http://127.0.0.1:5178` and run `node scripts/verifyResponsePerformanceUi.cjs` from `colin-backend`.
