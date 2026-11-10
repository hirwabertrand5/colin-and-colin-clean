# Monthly Retainer Statement

Implemented from the requested monthly retainer workflow and the supplied `retainer.pdf`.

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
- Utilisation is approved production divided by monthly fixed fee. Excess production is a management indicator and creates no automatic invoice or additional client debt. Included/excluded scope, extra-charge permission, out-of-scope approval references and the substantial overutilisation threshold are configurable.

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
