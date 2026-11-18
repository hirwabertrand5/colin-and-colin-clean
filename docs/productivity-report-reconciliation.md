# Productivity report reconciliation

The report's headline **Fees Earned** uses the same payment-period calculation as the dashboard. Its default earnings detail includes allocations funded by Paid invoices received in the period, including actions completed earlier. Completed work is counted separately by Key Action completion date in the firm timezone (`APP_TIMEZONE`, default `Africa/Kigali`).

The dashboard and report use Paid invoices received in the period (`paidAt`, with `updatedAt` for legacy invoices), the same `computeCaseEarnedFees` engine, recorded TPA rates, and current scores. Both pages show cents. The default earnings detail and the headline sum to the same amount. Selecting **Completed work** displays a separate valuation using current all-time collections and scores; that valuation is not the period's Fees Earned and is not a historical snapshot of the balance or quality score at completion.

| Value | Source and meaning |
| --- | --- |
| Completed Key Actions | Distinct matter ID + Key Action key with an attributed contributor in the selected completion period |
| Contribution records | One action, staff member and assignment role; several records can refer to one action |
| Dashboard Key Actions checked | Completed workflow steps in the selected member's current assignments |
| Sections completed | Every step in the section completed; date is the latest completion |
| Whole matters completed | Distinct completed workflows whose final action completed in the period |
| Contract and progress value | Matter financial settings and effective workflow percentages |
| Collected action base for earnings | Contract × action percentage, proportionally capped by linked Paid invoice collections received in the selected period |
| Quality | Case Management quality review; completed task quality scores are a legacy fallback |
| Timeliness | Shared Case Workspace work-event scoring rules |
| TPA | Recorded activity rate, then applicable user rate history |
| Fees | Action base × TPA × timeliness × quality; row rounding reconciles to shared matter earnings |
| Completed-work valuation | Valuation of actions completed in the period using all-time collections; available in the separate Completed work detail view |
| Matter reference | Court case number where present; transactional matters without a number display their parties and remain linked by matter ID |

Bases are counted once per action. Fees add across the contributor role records. Pending fees are excluded from calculated totals and counted explicitly. A total with no calculated fees stays pending. Recorded zero scores produce a calculated zero fee; missing scores remain null. Quality scores and financial allocations are never invented to clear an exception.

The default Earnings view can be changed to Completed work. Both views retain the full table: date/time, staff and role, matter/parties, Key Action and section/percentage, collected base and matter payments, TPA, timeliness and status, quality and source, formula, fee and allocation/review status with billing links. Search, sorting, pagination, issue filters and Excel exports remain available. The overview retains work counts, pending reviews, averages, zero allocations, missing matter details, the dashboard comparison and contribution reconciliation. Source definitions are collapsed. Work counts remain based on completion dates when switching detail views.

## Verification

- `npm.cmd --prefix colin-backend run verify:productivity`: isolated fixtures, real dashboard/personal/management report handlers, identical headline and detail fees, earlier work paid in-period, work paid outside the period, Kigali boundaries, missing data, zero scores, deleted and undated actions, and role deduplication. No database connection.
- `node scripts/verify-productivity-ui.cjs`: synthetic API responses, desktop/mobile rendering, filters, search, links and Excel contents. No production API connection.
- Frontend and backend production builds.

For a read-only live comparison, run `colin-backend/node_modules/.bin/tsx.cmd colin-backend/scripts/auditProductivityFees.ts STAFF_NAME FROM_DATE TO_DATE`. It loads the configured database connection and compares dashboard, personal report, management report and detail totals without writing records or indexes. Review zero-allocation reasons against billing and workflow percentages; obtain missing quality reviews from authorized reviewers and correct missing references on source matters. The reporting changes do not backfill production data.
