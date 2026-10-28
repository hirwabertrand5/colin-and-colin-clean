# TPA rate management

## Storage and permissions

User documents now contain `tpaHistory` and `tpaRevision`. Workflow steps and legacy tasks contain immutable `tpaSnapshots`, including contributor, assignment role, activity timestamp and applied rate. The existing earnings ledger adds `rateActivityAt` and `inputHistory` to retain prior financial inputs. No new collection or bulk data migration is needed. The first adjustment preserves the old role allocation as a baseline normal rate. Each rate configuration records its author, reason, recording time and effective period. User deletion is blocked once rate history exists; account deactivation remains available.

Managing Partner, Managing Director and Executive Assistant can administer rates. The latter two already hold user administration permission. Managing Partner receives access to the user list and TPA endpoints, without permission to create, delete or edit accounts. Other roles are rejected by the existing authorization middleware and the controller. General user updates cannot submit rate history.

## Calculation

`utils/tpaRates.ts` resolves normal and special rates. Periods include their start and exclude their end. Special rates take precedence. Normal changes during a special period become applicable when the special period ends. Overlapping special periods are rejected. Stopping a special changes its end and retains the original configuration in history and the audit event.

`buildRoleByName` carries user history into the existing shared earnings engine. Individual action allocations use the contributor's existing lifecycle timestamp (initiator work time, review time, approval time, or delegated contribution time). Case totals use collected-base-weighted rates when activities span different rates. Per-action reports retain individual rates. Independent tasks use the same resolver and recorded delegated contribution times. The collection cap, timeliness, quality and payment period rules remain in place.

Both normal and special rates require a selected **Starts from — date and time**. Special rates also support an optional end date. All rates and history rows come from stored data; there are no sample rates or fixed effective dates. The form initially proposes the next minute from the server clock. Normal and special cards show actual effective periods, and rate/status data refreshes every 30 seconds, including scheduled activations and stops. Unknown legacy start dates are labelled as unknown rather than displayed as an invented date.

API timestamps require a UTC suffix or explicit offset. The API supplies the firm's Africa/Kigali timezone; the UI interprets entered wall-clock dates in that zone and sends UTC timestamps. No browser timezone is used to interpret the effective date.

## History, corrections and concurrency

Changes use MongoDB transactions and a revision check; an audit event is committed together with the user history. Deployment requires a replica set or transaction-capable MongoDB cluster. No production database changes have been executed.

Backdating requires a separate preview and confirmation. The preview inspects actual case contributor events, delegated work, legacy task activities and saved earnings, including archived saved events. It compares the old and proposed effective rates, counts activities whose rate would differ, identifies preserved snapshots and saved earnings, and estimates differences separately by currency using confirmed collection bases and available scores. Missing financial inputs are counted explicitly; no financial estimate is invented. The proposed and actually applicable differences are distinguished because applied snapshots remain unchanged.

A change that would alter saved earnings is rejected and requires an explicit financial correction. This feature does not authorize or create accounting adjustment entries. Backdated configuration changes may affect legacy activities that have no applied snapshot, after explicit confirmation. Existing applied snapshots are preserved.

Rates are now captured automatically before workflow/task source saves, including delegated lifecycle events. Submitted snapshot values cannot override server-resolved rates. Legacy task query-based transitions are covered too. Financial inputs are captured automatically after workflow/task saves, case/scoring changes and invoice saves/payment updates, using the shared earnings engine. When a caller already has a transaction, capture joins it; otherwise the ledger refresh uses its own transaction. Collection or scoring changes retain the original applied rate, archive previous inputs, increment the revision and write an audit event. A unique event key prevents duplicate earnings. A report scoped to a collection period cannot overwrite the canonical all-collections snapshot.

Historical records predating any configured history retain the baseline role rate, but historical role changes that were never recorded cannot be reconstructed. No production backfill was run.

## Files

- Backend: user, workflow, task, invoice, case, audit and earnings-ledger models; `models/appliedTpaSchema.ts`; TPA/user controllers and user routes; `utils/tpaRates.ts`, `utils/tpaAttribution.ts`, shared workflow and earnings utilities; `services/earningSnapshotService.ts`, `services/tpaImpactService.ts`.
- Integration: workflow, case management, dashboard, firm reports, staff earnings and performance controllers; independent task service.
- Frontend: `TpaManagement.tsx`, `UserManagement.tsx`, `App.tsx`, `DashboardLayout.tsx`, staff earnings report and associate dashboard wording.
- Checks: `colin-backend/src/scripts/verifyTpaRates.ts`, `colin-backend/src/scripts/verifyTpaIntegration.ts`, `src/scripts/verifyTpaManagement.cjs`; backend `verify:tpa` package script.

## Validation

The TPA interface uses the New Retainer form's section, field, option-card and button styling. `StructuredForm.tsx` provides shared field and keyboard-accessible choice components to both forms. The standalone TPA dialog has a sticky header/footer, focus trapping and Escape dismissal, while the Edit User section supports the same controls inline. Normal/special/stop cards, open-ended or scheduled end dates, a current-time shortcut, review/edit flow, history filters, loading/success/error feedback, mobile stacking and dark styling are supported. No compensation API or financial calculation changes were needed for this visual redesign.

Backend TypeScript and frontend production builds pass. Resolver checks cover historical boundaries, special precedence, normal changes during special periods, stopping, timezone equivalence, role-map integration, collection calculation and invalid/overlapping inputs.

The TPA integration suite runs real HTTP handlers against a disposable local MongoDB replica set and covers 14 scenario groups: authorization; automatic snapshots; dated normal changes; special overrides/stops; overlap rejection; saved financial protection; backdated unsnapshotted impact; delegated collection handling; concurrency; audit rollback; historical reporting/tamper protection; legacy task query transitions; payment query transitions; required dates/timezones and audit completeness. It never reads production MONGO_URI.

The existing Independent Tasks database suite passes all 21 scenario groups. Browser checks against the production bundle verify a chosen start date with a different browser timezone, dynamic stored rates/history and financial impact, special start/end dates, cancellation and mobile width.

Run `npm.cmd run verify:tpa --prefix colin-backend`; the integration check requires the existing local test MongoDB binary. After `npm.cmd run build`, run `node src/scripts/verifyTpaManagement.cjs` for the browser checks. Browser test responses are isolated and cannot write to production.

Existing user-administration authority for Executive Assistant is retained. Finalized financial corrections remain outside this configuration operation and require the firm's explicit accounting approval process.
