# Productivity report reconciliation

The report has two date dimensions. Completed work is selected by Key Action completion date in the firm timezone (`APP_TIMEZONE`, default `Africa/Kigali`). Its collected allocations and scores reflect current records, including Paid invoices outside the selected period. This is not a historical snapshot of the balance or quality score at completion.

The dashboard's period fee uses Paid invoices received in that period (`paidAt`, with `updatedAt` for legacy invoices). It can include payments for work completed earlier. The reconciliation table calculates this separately using the same `computeCaseEarnedFees` engine as the dashboard and Case Workspace.

| Value | Source and meaning |
| --- | --- |
| Completed Key Actions | Distinct matter ID + Key Action key with an attributed contributor in the selected completion period |
| Contribution records | One action, staff member and assignment role; several records can refer to one action |
| Dashboard Key Actions checked | Completed workflow steps in the selected member's current assignments |
| Sections completed | Every step in the section completed; date is the latest completion |
| Whole matters completed | Distinct completed workflows whose final action completed in the period |
| Contract and progress value | Matter financial settings and effective workflow percentages |
| Collected action base | Contract × action percentage, proportionally capped by linked Paid invoice collections |
| Quality | Case Management quality review; completed task quality scores are a legacy fallback |
| Timeliness | Shared Case Workspace work-event scoring rules |
| TPA | Recorded activity rate, then applicable user rate history |
| Fees | Action base × TPA × timeliness × quality; row rounding reconciles to shared matter earnings |
| Matter reference | Linked matter's `caseNo`; missing references display the matter ID and stay linked |

Bases are counted once per action. Fees add across the contributor role records. Pending fees are excluded from calculated totals and counted explicitly. A total with no calculated fees stays pending. Recorded zero scores produce a calculated zero fee; missing scores remain null. Quality scores and financial allocations are never invented to clear an exception.

The table can be filtered for zero bases, pending quality/timeliness/fees and missing matter references. Matter links open the corresponding Key Action; billing links open its invoices. Exports contain full-period summary totals, dashboard reconciliation, detail filter context, source IDs, reasons and fee decimals.

## Verification

- `npm.cmd --prefix colin-backend run verify:productivity`: isolated fixtures, the real dashboard and personal report handlers, Kigali period boundaries, payment/completion differences, missing data, zero scores, deleted and undated actions, and role deduplication. No database connection.
- `node scripts/verify-productivity-ui.cjs`: synthetic API responses, desktop/mobile rendering, filters, search, links and Excel contents. No production API connection.
- Frontend and backend production builds.

The complaint's specific 708 / 110 / 316 counts, 180 zero allocations, 112 missing scores, 39 missing references and monetary totals cannot be confirmed from the complaint alone. Verify them using the affected member's current live records with 17 October–17 November 2026 selected. Review zero-allocation reasons against billing and workflow percentages; obtain missing quality reviews from authorized reviewers and correct missing references on the source matters. These changes do not alter production records or backfill scores.
