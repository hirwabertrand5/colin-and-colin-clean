# Profitability tabs and active matter totals

Local implementation and verification. Production deployment and live data counts have not been verified.

Profitability now retains financial and staff results for the same period instead of replacing one with the other. Both requests start when the page opens. Matter, client and practice-area views share the financial response, and the staff view is prepared before it is selected. A short, account-specific in-memory resource shares requests across page remounts. It expires after fifteen seconds and uses new keys after writes, account changes or reporting-date changes. Refresh bypasses cached responses. Returning focus to the page rechecks the report. Failed requests remain retryable, and responses from an earlier reporting period cannot replace the current one.

The staff endpoint projects only workflow/template fields needed for financial calculations, avoiding output documents, amendment history and other unused payloads.

The active-count discrepancy came from different lifecycle predicates. The matter list excluded workflow-completed and returned-to-intake records, while the management dashboard headline did not. Some reports counted every non-Closed record as active, including temporarily closed records. Counts now use one pure lifecycle helper shared by frontend and backend. Closed/completed workflows, temporarily closed, returned-to-intake and cancelled matters are excluded. Current staff assignment identities are deduplicated; historical task links and handovers do not increase a current staff portfolio. Prospects remain pipeline records and do not count as active matters.

The shared rule is used by the management dashboard, Active/Closed Matters lists, client pages, People & Capacity, task-board active counts, financial counters, profitability rollups, firm/personal/staff reports and active-matter calendar eligibility. Period-qualified profitability counts still apply the selected entry window; firm-wide and user-specific populations retain their appropriate scope.

## Verification

- Frontend production build and backend TypeScript compilation passed.
- Browser switching between prepared staff, practice-area, client and matter tabs took **32–191 ms**, with no repeat report download. Period switching, refresh, error recovery and data invalidation passed.
- A disposable database fixture with **105 active matters** plus completed, paused, cancelled and returned-to-intake records produced 105 across list/dashboard rules, firm/personal/staff reports, client/practice rollups and the staff summary. Pausing and reopening a matter changed the next report immediately.
- Browser tests separately confirmed 105 on both the dashboard and Active Matters list, matching client and People & Capacity totals. Temporary and completed lists stayed separate.
- Profitability date, payment/refund, retainer balance and staff earnings regression checks passed. Navigation request sharing, write invalidation and account-separation checks passed.

Reproduce from the root:

```text
npm.cmd run build
node scripts/verify-profitability-ui.cjs
node scripts/verify-active-counts-ui.cjs
node scripts/verifyNavigationRequests.mjs
```

From `colin-backend`:

```text
npm.cmd run build
node dist/scripts/verifyActiveMatterCounts.js
node dist/scripts/verifyProfitabilityPeriods.js
```

Browser timings use synthetic API responses. Local results do not establish production latency; network delay and server startup can still exceed one second. Database tests use disposable local records and do not load production credentials.
