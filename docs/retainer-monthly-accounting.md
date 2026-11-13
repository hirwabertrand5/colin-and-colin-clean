# Monthly Retainer Statement

Implemented from the requested monthly retainer workflow and the supplied retainer documents, including `retainer.docx`.

## Retainer detail page

- The selected month controls the entire Monthly Retainer Statement. Choosing an unrecorded month clears the previous statement's figures; preparing a statement remains an explicit action. Historical statements are available through **Recorded statements**.
- **Department summary** sits below the monthly overview. It shows currently linked matter counts alongside the selected month's approved tasks, production, production share, revenue credit and staff TPA, with a total row. Before a statement is prepared, monthly amounts show a dash. Current matter counts and historical production are deliberately labelled separately: unlinking a matter does not erase recorded production or earnings.
- **Staff earnings by case** groups approved contribution snapshots by user ID. Expand a staff member to see production, task counts, applicable historical rates and accrued TPA for each case and recorded department. Shared task contributions are counted once in total production; each contributor sees their own share. Reversed services are excluded. The page adds existing earned TPA amounts rather than recalculating historic earnings using today's staff rate.
- CSV exports include departmental totals, individual staff totals, case earnings and the underlying task register.
- Workspace overview includes linked matters with department, status, retainer production, received revenue credit, direct expenses, staff earnings and net contribution. Monthly statement entries, corrections and audit history remain in the separate Monthly statements view. Agreement details are always visible above both views.

## Terminology and implementation review

The retainer follows the supplied document and the user’s clarification: the client pays a fixed monthly fee each month, while different matters may be handled in Dispute Resolution and Transaction & Advisory. The feature uses the document’s terms: **Monthly Retainer Statement**, **Retainer Performance Dashboard**, **Departmental production**, **Total production**, **Departmental revenue allocation**, **Individual monthly production**, **Individual TPA**, **Retainer utilisation**, **Excess service value**, and **Unutilised retainer revenue**.

The earlier implementation exposed subscription/hybrid choices, showed no monthly contract value on the retainer overview, allowed an independently selected service department, and showed matter budgets as if they were the value of approved retainer work. These were corrected: the retainer agreement has one fixed monthly fee; the matter’s selected department governs departmental production; the matter view shows the ordinary professional value of approved work actually recorded in the Monthly Retainer Statement. Existing accounting history is preserved.

## Policy and calculations

- A retainer client pays the same **fixed monthly fee** under the retainer agreement each month. This is the monthly retainer contract value described by the user. New retainer agreements have one fixed monthly fee; there are no subscription or hybrid billing choices. Earlier records remain readable, and entering their fixed monthly fee in the retainer agreement makes them available for a Monthly Retainer Statement. Earlier contract-value history is preserved without treating it as actual revenue received.
- Recording the fixed monthly fee for a month prepares its **Monthly Retainer Statement** exactly once. The amount comes from the retainer agreement, and the monthly utilisation threshold is preserved with it. Changes require an approved amendment. The system does not automatically create past Monthly Retainer Statements or collect payments.
- Record each receipt once, with its received date and bank/payment reference. Partial, late and excess receipts are supported. Cash belongs to its received-date reporting period, even when it funds an earlier service month.
- An existing **Paid** matter invoice can be transferred into a monthly statement. The amount, invoice number and payment date are read from the invoice. Its original record remains, tagged with `retainerReceiptId`; financial and ordinary TPA queries exclude the tagged invoice and include the retainer receipt instead. New receipts must represent money not already entered in a matter invoice. Payment references are unique across retainers, case-insensitively.
- A service must reference an approved (`Completed`) workflow action on a linked matter. Its performed date uses the actual completion tick/checklist evidence before submission or approval timestamps, so later approval does not move January work into February. It must belong to the service month and agreement term. The ordinary professional fee can be confirmed or corrected by management; it is not a new invoice. Work that still awaits review/approval is excluded.
- Each service belongs to **Dispute Resolution** or **Transaction & Advisory**. The matter's selected department is used automatically and the server rejects a different department. Older matters can use their existing case type when no department was selected. Assigned/contributing staff are selected by user ID and their positive contribution percentages must sum to 100%. The applicable TPA percentage is preserved for the month in which the approved workflow task was completed.
- Following the document, **Individual TPA = Individual monthly production × applicable TPA %**. **Individual monthly production** is the staff member's contribution to approved workflow tasks. It is calculated from the ordinary professional fees of those tasks. **Actual revenue received** is recorded separately.
- Following PDF section 5, **allocable revenue = min(actual receipts, approved ordinary work value)**. Departments receive this revenue in proportion to their approved production. Any unused receipts stay at firm level. Whole-franc rounding reconciles service, department and receipt allocations.
- Example: fixed fee/receipt RWF 1,000; Dispute production 1,500; Transaction production 1,800. Actual revenue is 1,000; department credits are 455 and 545; production is 3,300; utilisation is 330%. At TPA rates 5% and 6%, staff accrue 75 and 108. For production of 500 against receipts of 1,000, 500 is allocated and 500 remains unutilised at firm level.
- Utilisation is approved production divided by monthly fixed fee. Excess production creates no automatic invoice or additional client debt. The agreement form records covered services; legacy exclusions, charging controls and threshold settings are no longer exposed in the retainer interface.

## Duplicate prevention and corrections

- `(retainerId, month)` is unique. Reopening an existing month never books another fee.
- A covered workflow action is claimed on `Case.retainerCoveredActionKeys`. The shared ordinary earnings engine excludes it in the matter workspace, snapshot service, staff dashboard and reports. Claims remain after unlinking the agreement or reversing work.
- An action with already recorded positive ordinary earnings cannot be transferred. An invoice on a matter with positive ordinary earnings cannot be transferred either. Reconcile those historic earnings before migrating; the feature does not silently rewrite payroll history.
- Recognised service/contributor/rate snapshots are the retainer earning register. Staff TPA and management reports project those snapshots directly. Regenerating or persisting an ordinary Staff TPA report never writes a second retainer earning into the ordinary ledger.
- Closing a month locks service changes. Reopening, fee amendments and reversals require reasons and retain audit history. Late receipts can still be entered against a closed month. Reversed services can be replaced in their original month using the same approved action; only the active replacement counts. Reversed receipts can be restored with a reason. Reversed payment references remain reserved, so a replacement receipt uses a distinct correction reference.
- Retainers with monthly accounting history cannot be deleted. Agreement fee changes affect future statements; amendments to an existing month are explicit and audited.

## Reporting

Billing, Billing & Margins/profitability and Management Reports include fixed fees once in billed totals and receipts once in collected revenue. Open retainer obligations are separate from ordinary work values. Department revenue credit attributes the same received cash; it is never additional firm revenue. Known accrued retainer TPA is deducted once in net profit. Ordinary staff cost and overhead allocation limitations remain as before.

The shared retainer performance panel shows service-month statements, received-date revenue, approved production, TPA, utilisation, department credits and unused cash. Matter profitability receives attributed service revenue; agreement-level fees, receivables and unused cash are shown separately. Staff TPA, personal productivity and staff dashboard earnings include retainer contributions.

## Use and verification

1. Deploy both frontend and backend. No new environment variables or external services are needed. MongoDB must support transactions (the application's existing requirement). The two new collections and unique indexes are created through the Mongoose models.
2. As authorised management, open **Matters → Retainers**. Create/edit the retainer agreement, enter its **fixed monthly fee**, **Services covered**, **Services excluded**, **Monthly utilisation threshold**, and whether **Additional work is separately chargeable**. Activate the retainer agreement.
3. Link the relevant matters. Use their normal workflow to complete review and approval of delivered services.
4. Select the month and choose **Record fixed monthly fee**. In the **Monthly Retainer Statement**, use **Record service** to select an **Approved workflow task**, confirm its **Ordinary professional fee** and **Assigned/contributing staff**, then choose **Record approved workflow task**. Use **Record actual revenue received** to record the payment, or select the existing paid invoice when the payment is already in the system.
5. Check **Departmental revenue allocation**, **Individual monthly production**, **Individual TPA**, **Retainer utilisation**, **Excess service value**, and **Unutilised retainer revenue**. Choose **Export Monthly Retainer Statement**, then compare the same dates in **Billing & Margins**, **Staff TPA**, and **Management Reports**. Close the month after review.

Run `npm.cmd run verify:retainers` from `colin-backend`. It uses a disposable local MongoDB replica set and never reads the production MongoDB URI or sends emails. Existing TPA regressions use `npm.cmd run verify:tpa`. Frontend validation uses `npm.cmd run build` and `node scripts/verify-retainer-ui.cjs`.
## Retainer workspace overview

The agreement overview displays all saved form details: agreement/client in the page heading, status, monthly fee, billing day, term, renewal review, covered services and internal notes. The creation and edit forms no longer expose a retainer-level responsible partner, exclusions, a utilisation threshold, additional-work charging or scope approval settings. Responsibility comes from the teams assigned to linked cases. Legacy stored fields remain compatible with existing records.

Case teams and earned fees lists each linked case's Initiator, Reviewer and Signer/Approver by name, even before any monthly service is recorded. The server batches case workflows, templates, tasks and staff records and uses the shared case earned-fee engine for roles, TPA, timeliness, quality, collected base and earned fee. Handover and delegated contributors remain visible. Missing scores and earned fees remain pending; real zeroes stay zero. Ordinary case earned fees are displayed separately from recorded retainer TPA and do not change retainer accounting totals.

Workspace overview shows cumulative totals across recorded monthly statements. Monthly statements remains a separate view for recording and correcting fees, approved services and receipts. Successful accounting changes refresh the workspace totals and linked-case breakdown without a page reload.

`GET /retainers/:id/cases` returns an `accounting` summary scoped to that retainer, plus each currently linked case's retainer revenue credit, work value, direct expenses after refunds, contributing staff, accrued TPA and net contribution. Reversed receipts and services do not contribute to totals. Historical accounting stays attributed to its original retainer after a case is unlinked; linked-case expenses cover currently linked cases only.

- Department revenue credit is received cash allocated to approved work. Unallocated cash stays at firm level.
- Department net contribution is revenue credit minus current linked-case expenses and accrued TPA. Services retain their recorded department; expenses use the case's current department.
- Case net contribution is that retainer's revenue credit minus direct case expenses and that retainer's accrued staff TPA. Standalone invoices are excluded.
- Firm net after costs and TPA is total retainer receipts minus current linked-case expenses and all accrued retainer TPA, before overheads.
- Collection percentage uses paid amounts capped separately against each recorded month's fee, so an overpaid month does not hide another month's arrears.
