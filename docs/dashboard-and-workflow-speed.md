# Dashboard, staff profitability and workflow speed

13 November 2026. Local implementation; deployment has not been performed.

Staff profitability now reads its inputs concurrently and skips unrelated financial, prospect and client reporting queries. It avoids recalculating matters with no work in the requested period. Retainer earnings read only periods containing relevant production, with indexed receipt lookups. The reporting period presets and labels come from the same constant as Firm Reports: Today, Last 7 Days, This Month, Last Quarter, Last Year, Year to Date and Custom Range.

All role dashboards start one authenticated data stream immediately after sign-in. Sections render as they arrive instead of waiting for the slowest source. The stream reuses the existing source visibility rules and preserves finance and audit permissions. Data is account-specific and consumed for the initial view; revisits load fresh results. Staff summaries load their joined financial inputs in one database aggregate and include current assigned matter work items, replacing up to sixty separate Case Management HTTP requests. Executive dashboard reads run concurrently and share their matter-label lookup.

Case Workspace shows ticks, additions, deletions and amended deadlines immediately. Ticking unlocks the next permitted action without waiting for the preceding HTTP response. A queue persists actions in order, prevents duplicate submissions, preserves queued edits when earlier responses arrive and cancels dependent edits after a failure. Failed changes restore the confirmed checklist; failed additions and amendments retain entered form values. Saving remains visibly indicated until persistence finishes. Server sequence and permission checks still apply.

Workflow changes snapshot earnings once after both workflow and case progress are saved. A joined transaction read replaces six sequential financial-input queries. Structural changes preserve existing activity-time rates, and unchanged completion sets skip unrelated independent-task updates. Deadline emails use the durable pending queue; in-app notification persistence still completes before success.

## Measurements

Final successful local HTTP measurements using disposable MongoDB:

| Request | Completion |
| --- | --- |
| Staff profitability | 65 ms |
| Staff dashboard summary including work items | 40 ms |
| Add Key Action | 546 ms |
| Delete Key Action | 321 ms |
| Amend deadline | 543 ms |
| Tick Key Action | 407 ms |

The complete dashboard stream finished in **30–95 ms** for synthetic accounts across all fifteen roles. Frontend production build, backend compilation, all twenty-seven retainer accounting checks, profitability period checks, workflow lifecycle/permissions, immediate and idempotent earnings persistence, durable notification processing and failed-save rollback checks passed.

Browser tests using synthetic data measured sign-in through visible dashboard data across all fifteen roles in **283–523 ms** in the first complete run. The final run measured **290–401 ms** for fourteen roles and **1,487 ms** for the first management dashboard on a cold browser while local builds were running. A deliberately delayed calendar response did not block core data. The tests delayed workflow saves by 1.2 seconds and measured visible responses of **44–102 ms**, including immediate access to the next action. They verified ordered requests, response reconciliation, failed-save rollback, cancellation of dependent ticks and no extra workflow GET after a save. The cold result means a universal sub-second dashboard guarantee is not established by these tests.

These are local measurements, not a production latency guarantee. Deploy the frontend and backend together; dashboard streaming requires the new backend endpoint. Production network, proxy buffering and database/server startup still affect completion time.

## Reproduce

From the root:

```text
npm.cmd run build
node scripts/verifyOptimisticQueue.mjs
node scripts/verify-dashboard-and-workflow-speed.cjs
node scripts/verify-profitability-ui.cjs
```

From `colin-backend`:

```text
npm.cmd run build
node dist/scripts/verifyResponsePerformance.js
node dist/scripts/verifyProfitabilityPeriods.js
node dist/scripts/verifyRetainerAccounting.js
node dist/scripts/verifyDeadlineAmendmentModes.js
```

Database scripts use the existing local test binary and disposable databases. Browser scripts use local fixtures, stop their servers and close their browsers afterward.
