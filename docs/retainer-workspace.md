# Retainer workspace

The workspace leads with the saved fixed monthly fee, billing day and agreement dates. It then shows linked-case collections, calculated staff fees, net contribution, department performance, named staff totals and expandable case teams.

The new/edit agreement form contains only agreement name, client, status, start/end dates, renewal review, fixed monthly fee, billing day, covered services and internal notes. New agreements use monthly billing. Legacy contract-value records are retained in storage.

`GET /retainers/:id/cases` batches workflows, templates, tasks, invoices and user TPA histories. Each case's team, scores and earned fees come from `computeCaseEarnedFees`, the same engine used by the case workspace. Selected legal-service departments take precedence over older case-type labels. Unclassified cases remain visible in a separate department card.

- The fixed monthly fee is the saved agreement amount. It is not added to case invoice collections.
- Staff totals sum actual case-role earned fees. Available scores are averaged for each staff member; expanding a case displays the original seven-column role table.
- Missing scores and earned fees remain pending (`_`). Real zeroes display as zero.
- Net contribution = collected case fees − direct client expenses after refunds − calculated staff fees. It excludes overheads and uncalculated staff fees; pending fees make the displayed contribution provisional.
- Department and case totals refresh after linking/unlinking or editing the agreement, through Refresh, and when returning focus to the workspace.

Local verification: `npm.cmd run build`, backend build plus `node dist/scripts/verifyRetainerWorkspace.js`, and `node scripts/verify-retainer-workspace-ui.cjs`. Integration checks use a disposable local database; browser checks use synthetic API data.
