# Billing & Finance workspace

16 November 2026. Local implementation based on the menu and financial source tables in `NAVIGATION ARCHITECHURE (1).pdf`, especially pages 1–2 and 8–12. Profitability's page, controller and routes remain unchanged.

## Pages and authoritative records

| Page | Content | Source |
| --- | --- | --- |
| Financial Dashboard | Contract value, billings, collections, open invoices, direct costs, overheads, gross/net contribution and margins, monthly trend, matter ledger | Cases, Invoices, PettyCashExpenses |
| Billing & Invoicing | Invoice counts/values, status at report end, payment terms, average bill, current completed work awaiting billing | Invoices and Cases |
| Collections & Receivables | All open balances at report end, confirmed overdue balances, due-date ageing bands, weighted invoice age and follow-up register | Invoices linked to Cases |
| Cash & Cash Flow | Collections and refunds as inflows, recorded expense payments as outflows, net movement, current active-fund balances, adjustable 30-day collection/spend scenario | Invoices, PettyCashExpenses, PettyCashFunds |
| Expenses & Procurement | Gross recorded costs, dated refunds, direct/internal allocation, fund filter, vendor spend register | PettyCashExpenses, Cases, fund names |
| Firm Remuneration | Earned fees and calculation inputs for completed actions, staff/role/matter groupings, funded/unfunded work bases, missing inputs | Existing staff earnings engine, activity-time TPA and earnings ledger |

## Financial rules

- Existing reporting periods use `APP_TIMEZONE`, defaulting to `Africa/Kigali`, with inclusive starts and exclusive ends. The shared period picker retains the application's presets and validates custom ranges.
- Contract values, billings and costs use system entry timestamps, matching the existing Profitability report. Collections use `paidAt`, falling back to `updatedAt` only for legacy paid invoices. Later document or payment-term edits preserve that legacy payment instant.
- Refunds reduce costs in the refund period, including refunds of expenses entered earlier. A period can therefore have negative net costs.
- Receivables include every invoice entered by the report end, including older invoices and invoices paid after that end. Draft and partial-payment states are not inferred from the existing Pending/Paid model.
- Collection rate = collections during the period / billings entered during the period. It can exceed 100% when older invoices are collected. Invoice settlement rate separately measures the paid share of invoices entered in the selected period.
- Gross profit = collected revenue − direct matter costs. Net profit = gross profit − recorded internal costs. These reflect the currently recorded cost sources; they do not infer payroll or overhead allocations.
- Overdue requires an explicit saved `dueDate`. Unknown terms have their own ageing band; invoice issue dates are not assumed to be due dates. Existing finance write roles can save/clear terms in the record drawer; creation forms also accept an optional due date. Current saved terms apply when reporting historical periods because term-history records do not exist.
- Completed-work billing opportunities use the current matter progress snapshot less billings recorded by the report end. They are review prompts, not approved invoices or a reconstructed historical work ledger.
- Cash movement is a transaction movement ledger, not a reconciled bank balance. Fund allocations/top-ups are not added again as client revenue. Current petty cash is labelled as a live balance and is unavailable under a selected service allocation. Forecast collection confidence and planned payments are user assumptions; the default spend is 30 days of the selected period's average net costs.
- Remuneration reuses the existing completed-action calculation, preserves null fees for missing inputs, and counts funded/unfunded action bases once across staff. Role and staff filters apply to the aggregates. Earned fees do not establish accrued, payable, deferred or paid payroll balances. Those remain explicitly unrecorded until approval/disbursement records exist.
- Vendor spending is available from recorded expenses. Purchase orders, supplier invoice approvals and procurement commitments are not represented as existing records.

## Loading and interaction

`GET /api/billing/workspace/:section` returns the selected section's summaries and one page of records. Independent projected queries run together; the five financial views do not load full workflows, staff reports or every petty cash fund's expense endpoint. Financial summaries include all matching source records and no 500-expense truncation.

Search, status, fund, sorting and pagination run on the server. Table filters leave period/service/staff summary cards intact, as the register explains. Exports retrieve every matching page before loading the existing Excel/PDF exporter. Amounts sort numerically, missing values remain last in both directions, and pagination uses a deterministic identifier tie-breaker.

Filters live in the URL; date changes hide old-period figures. Superseded requests cancel immediately. Search remains mounted to retain keyboard focus and uses the same 42px control, 14px text, inset search icon and focus ring as the matter list.

The browser shares in-flight requests and completed responses for 20 seconds after successful completion. Its bounded cache is account-scoped and invalidates on application writes. A matching request that is still running does not expire and start a duplicate. Pointer/focus navigation prepares the focused finance response alongside the page code. Refresh bypasses both browser and server snapshots.

The server shares projected sources across financial pages and caches each period's unfiltered register for 20 seconds. Search, status, sorting, pagination and exports reuse it. Remuneration grouping tabs reuse a single earnings result; its first load reads full history only for matters with possible work events in the selected period. The shared earnings engine still determines the exact timestamp, collection allocation and fee, including carried work, task fallbacks and legacy dates. Authentication and role guards run before every cached response. All HTTP mutations invalidate snapshots before and after their write; changes made by other processes are bounded by the short TTL.

Requests no longer fail at the former hard 15-second cutoff. A first attempt has a 20-second connection/read budget, with one automatic 25-second recovery attempt for timeouts, connection failures or temporary 408/502/503/504 responses. Authentication, permission and validation failures are not retried. A slow request displays progress after two seconds and remains cancellable by navigation. These recovery budgets accommodate a slow server; they do not claim that such a server responds in under one second.

Existing reporting access is preserved. Due-date writes retain the existing Managing Director/Executive Assistant restriction and write to the invoice audit trail. No production records were changed.

## Verification

Run from the project root:

```text
npm.cmd run build
npm.cmd --prefix colin-backend run verify:finance-workspace
node scripts/verify-finance-workspace-ui.cjs
```

The HTTP checks use the existing local MongoDB test binary and a disposable database without loading `.env`. They cover reconciliation with Profitability, historical payments, separate refund periods, due dates, permissions, validation, numeric sorting, missing values, pagination, filters, vendor and remuneration rollups, and more than 500 expenses. One measured local run returned all six responses in 15–132 ms with approximately 2–6.4 KB per response; this is not a production latency measurement.

Browser verification uses the production build and synthetic intercepted responses. It covers all six pages, rapid period changes, custom dates, search focus, pagination reset, sorting, payment-term edits, errors/retry, complete Excel/PDF exports, forecast inputs, mobile containment and dark mode. Screenshots are saved under `build/verification/finance`.

After the timeout follow-up, a local real-HTTP run measured warmed finance responses at 17–30 ms. Assertions also verify that concurrent period requests share their source queries and that search/sort/page changes and remuneration grouping add no finance database reads. Financial writes and explicit refresh invalidate those snapshots.

The updated browser run measured in-app navigation at 98–186 ms with synthetic 50 ms responses. It also reproduces a healthy response arriving after 16 seconds (beyond the former deadline), verifies that it succeeds without an error, checks cancellation of superseded reads and confirms automatic recovery after a temporary gateway failure. The initial full application load took 1.8 seconds; subsequent full browser navigations took 232–296 ms. These browser figures are separate from the real MongoDB HTTP timings above.

Frontend and backend must be deployed together to use the new workspace endpoint. Production end-to-end response times still need measurement after deployment, including network, database location and server startup.
