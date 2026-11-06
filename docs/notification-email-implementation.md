# Notification email implementation

## Audit findings

The application stores in-app alerts in MongoDB `Notification` records. Controllers and the reminder scheduler use `createNotification`, `notifyUsersById` and `notifyRoles`. Preferences belong to the individual user. Email delivery uses the existing Resend SDK.

Confirmed issues addressed:

- The local backend lacked sending credentials and sender configuration. The requested placeholder and sender, reply-to, finance and timezone settings were added without replacing existing environment values.
- Reminder deduplication applied to the in-app record but did not stop the subsequent email call. Concurrent scans also had no unique database guard.
- Reminder timing was hardcoded; custom settings were ignored and event times depended on the server timezone. Independent overdue tasks were alerted repeatedly every day.
- Petty cash creation, ordinary expenses, direct reviewer requests, returned work and several completion paths lacked email handlers.
- Direct task stage changes to Awaiting Review also needed a reviewer trigger, independently of the explicit submit-for-approval endpoint. Deadline amendments now include active temporary contributors, and final approvals include the actual contributors after their tasks complete.
- Case review/approval handlers created two in-app records for a single request. Matter take requests bypassed email preferences and used relative email links.
- Financial notifications were created outside their surrounding financial transaction, allowing an email for rolled-back work.
- A low-balance flag was not rearmed after refund/deletion recovery; replenishment reset it even when the fund remained below the threshold.
- Failures were discarded. There was no persistent delivery history, retry worker or signed webhook endpoint.
- Notification read updates did not restrict the notification to its audience. Some staff roles could not access their email preferences. Task submission lacked its existing task-access check.
- Calendar routes allowed unrelated signed-in users to create or change another matter's events. Event changes now enforce the existing matter assignment/admin permissions and validate date/time before creating any alert.
- Intake submissions/clarification already generated internal alerts, which now use the same delivery path. Prospect follow-ups and retainer renewal dates had no internal email reminder path.
- Browser inspection found unread cards retained a light background behind light text in dark mode. Scoped notification styling now provides readable dark backgrounds and event-specific icons.

No production database, DNS settings or provider settings were changed. Existing notification records and read states are retained.

## Architecture and changed files

`services/notifyService.ts` persists the in-app event and queues email automatically according to its type. Callers no longer need to supply HTML for email to exist. Transactional callers pass their MongoDB session: notification and business change commit together; the worker queues delivery after commit.

`models/emailDeliveryModel.ts` stores one delivery per notification and recipient with a unique key. `services/emailDeliveryService.ts` performs atomic worker claims, rechecks preferences and reminder validity, sends one recipient per message, and records outcomes. The new unique `Notification.eventKey` index applies only to new keyed records, allowing historical duplicate dedupe keys to remain unchanged.

`services/notificationTemplateService.ts` builds branded, escaped templates with the event's title, details and an absolute application link. Links are restricted to the configured application origin. Existing legacy controller HTML arguments remain source-compatible but delivery uses the common escaped template.

`controllers/emailDeliveryController.ts` verifies raw Resend webhook signatures and exposes managing-director-only delivery diagnostics. `models/emailWebhookModel.ts` stores deduplicated minimal webhook receipts, including callbacks that arrive before the send response has been recorded. Bodies and credentials are excluded from diagnostics.

`jobs/reminderScheduler.ts`, `jobs/businessReminders.ts` and `utils/notificationTime.ts` implement configurable timing and explicit application timezone conversion. `services/reminderValidityService.ts` suppresses stale queued reminders after completion, submission, deadline changes, ownership changes, pause/closure or expiry of their reminder window.

`jobs/pettyCashDigest.ts` summarizes the previous complete local day's committed financial notifications. Rows include the actual recorded running balance. The summary explicitly labels any current fund balances as current; it does not invent historical closing balances or alter financial calculations.

The task, independent-task, case, workflow, event, case-management and petty-cash controllers/services connect their actual business transitions to this flow. `activityNotificationService.ts` resolves relevant people and delegated review handoffs. Preferences/models/routes and both settings screens expose the new controls. `NotificationCenter.tsx` includes the additional event filters and groups existing case review/approval identifiers in Approval Requests.

## Email notification matrix

Every row below has an in-app alert. Email delivery obeys the global rollout flag, allowlist, active-user status, individual master switch and category settings. Each email has a permanent unique notification/recipient ledger key.

| Event | Trigger | Recipients | Timing / duplicate prevention |
| --- | --- | --- | --- |
| Task assignment | Task creation or actual reassignment | Assigned person; changed stage/supervisor holders on update | Immediate queue; reassignment revision key |
| Task approval request | Work submitted | Actual supervisor/reviewer and existing MD/EA coordinator audience | One shared event and one email per recipient, including overlapping roles |
| Case review/approval | Work handed to next lifecycle role | Actual reviewer/approver; delegated role holder when handing off delegated work | Immediate; persisted handoff timestamp key |
| Returned work | Task rejection or Key Action returned for correction | Responsible initiator/contributor | Immediate queue; correction event / decision revision |
| Completed approval | Task or Key Action final approval | Relevant owner, supervisor and case participants | Immediate queue; approval/completion revision |
| Matter take request / decision | Request submitted, approved or denied | Existing request audience / requester | Immediate; request ID and decision key; matter preference |
| Matter responsibility/status change | Assignment or case status changes | Current matter participants | Immediate; matter revision key |
| Task deadline amendment | Actual task due date changes | Assignee, supervisor, assigner | Immediate; update revision key |
| Legal deadline amendment/revocation | Workflow deadline amended or amendment revoked | Standing participants and active delegated task holders/supervisors | Immediate critical alert; amendment revision key |
| Normal task reminder | Deadline threshold crossed | Active assignee | Configured first reminder (24h default), 2h, one overdue alert |
| High-priority reminder | Deadline threshold crossed | Active assignee | 48h, configured first reminder, 2h, one overdue alert |
| Critical legal / critical task reminder | Active legal Key Action or Critical independent task | Responsible initiator/assignee | 72h, configured first reminder, 2h, overdue; one coordinator escalation after configured overdue interval |
| Low-priority reminder | Deadline threshold crossed | Active assignee | First reminder only |
| Event reminder | Upcoming calendar time | Matter assignee and existing MD/EA coordinators, without audience overlap duplicates | Individual event hours (24h and 2h default), interpreted in APP_TIMEZONE |
| Event creation/rescheduling/cancellation | Calendar event mutation | Matter participants | Immediate; event action/revision key |
| Petty cash allocation / replenishment | Fund created or topped up | MD, existing EA audience and FINANCE_ALERT_EMAIL | Immediate; each committed business event |
| Petty cash low | First crossing of configured fund threshold | MD, existing EA audience and FINANCE_ALERT_EMAIL | Immediate; crossing timestamp key; recovery rearms next crossing |
| Expense / refund / deletion | Financial action commits | Existing MD/EA audience | Daily summary default; immediate/off configurable per user |
| Petty cash summary | Previous local day has recorded activity | MD/EA with daily preference; finance copy | Once after PETTY_CASH_DIGEST_HOUR; unique local-date key |
| Client intake / clarification | Existing intake submission/reply handlers | Existing assigned intake staff | Immediate queue; intake submission key where supplied |
| Prospect follow-up / stage due | Active, open, unconverted prospect due date reached | Assigned associate and responsible partner | Once per effective due date; no inactive/temporarily closed prospect |
| Retainer renewal/end | Active contract's renewal/end approaches | Responsible partner, with creator fallback | 7 days, 1 day, one overdue alert; effective-date key |

Reminders use persistent event keys containing the entity, effective deadline, recipient and threshold. Restarting or running multiple workers does not erase these keys. A short-deadline task receives the nearest relevant threshold, rather than a burst of all missed thresholds. Completed/closed/cancelled work and submitted work awaiting review do not receive assignee deadline reminders. Work ticked Done stops the legal-work deadline clock. Delegated Key Actions use the independent task reminder path instead of generating a second legal reminder.

Date-only task deadlines retain the application's existing noon-UTC convention (14:00 Kigali); the implementation does not change legal/business deadline calculations. Calendar events use explicit wall-time conversion in APP_TIMEZONE. Historical records/read flags are not migrated or deleted.

## Environment configuration

Set these on the backend service, never in VITE variables:

```dotenv
RESEND_API_KEY=your_private_key
EMAIL_FROM="Colin & Colin Legal Solutions <info@colinandcolin.com>"
EMAIL_REPLY_TO="info@colinandcolin.com"
FINANCE_ALERT_EMAIL="cg@colinandcolin.com"
APP_TIMEZONE="Africa/Kigali"
PUBLIC_CLIENT_URL=https://colin-and-colin.vercel.app
CLIENT_URL=https://colin-and-colin.vercel.app
NOTIFICATION_EMAIL_ENABLED=false
NOTIFICATION_EMAIL_ALLOWLIST=
RESEND_WEBHOOK_SECRET=
PETTY_CASH_DIGEST_HOUR=8
```

`your_private_key` is deliberately rejected as a placeholder. Replace it only in the backend hosting environment/local ignored `.env` with the real Resend sending key. Retain existing MongoDB/JWT/other environment settings. The checked-in `.env.example` contains no secrets.

## Deployment and controlled rollout

1. Configure the real Resend API key and verify the sender domain in the firm's Resend account using the provider's DNS instructions. This requires external configuration; this task does not modify DNS.
2. Set the environment variables on Render. `PUBLIC_CLIENT_URL` must be the staff application's public origin so email buttons open valid routes.
3. Build the backend with `npm run build`, start with `npm start`, and build/deploy the frontend using its existing deployment flow. Startup waits for the additive notification/delivery/webhook indexes before enabling the workers. Do not use `syncIndexes()` to remove unrelated indexes.
4. Keep a continuously running backend instance. The scheduler scans on startup and once a minute; the delivery worker runs every 10 seconds. No separate external cron is necessary. Multiple application instances share the durable claim/deduplication indexes.
5. Register `https://<backend-host>/api/webhooks/resend` in Resend for `email.delivered`, `email.bounced`, `email.complained`, and `email.failed`. Copy the endpoint's signing secret to `RESEND_WEBHOOK_SECRET`. The route must receive the unchanged JSON body; Express raw parsing is registered before its JSON parser.
6. Leave `NOTIFICATION_EMAIL_ENABLED=false` until sender configuration is ready. To validate a rollout, set `NOTIFICATION_EMAIL_ALLOWLIST` to explicitly approved safe recipients, then set the flag to `true`. Alerts suppressed while disabled or outside the allowlist are not replayed automatically when rollout settings change.
7. The managing director can inspect Settings → Email Integration for configuration status, delivery counts, recent failures and queue recovery errors. The explicit connection-test button uses the existing immediate test-email route and is independent of the automatic-notification rollout flag.
8. After verifying safe recipients, adjust the allowlist for the intended production audience. Confirm each user's email/category preferences and their petty cash summary/immediate choice.

Provider failures classified as transient retry up to five total attempts, at 1, 5, 15 and 60 minutes. Invalid sender/key/recipient and domain failures stop and appear in diagnostics. A crashed worker's two-minute lease can be recovered with the same provider idempotency key. Ambiguous attempts older than 23 hours stop for manual provider-log review, inside Resend's documented 24-hour idempotency window. Fixing configuration does not automatically replay permanently failed or suppressed emails.

Existing client-facing intake invitations, surveys, prospect thank-you emails and the legacy ownership-transfer client email remain their existing transactional flows. They inherit EMAIL_REPLY_TO but are separate from the internal notification rollout/ledger. No new automatic client billing or collection emails were introduced.

## Validation

`npm run verify:notifications` runs the new regression suite against a disposable MongoDB replica set. Resend requests are intercepted; only `@test.invalid` recipients are accepted, and external network requests are rejected. It never reads `.env` or a production database. The suite exercises real API handlers, persistent records, scheduler scans, worker claims and signed webhook requests.

`npm run verify:independent-tasks` is the existing workflow regression suite. Backend `npm run build` performs TypeScript checking; root `npm run build` builds the production frontend. Neither package currently defines a separate lint command.

| Verification | Final result |
| --- | --- |
| Backend `npm run build` | Passed; TypeScript check |
| Frontend `npm run build` | Passed; production build |
| `npm run verify:notifications` | 43 groups passed; real isolated API/database tests, mocked Resend |
| `npm run verify:notifications -- --focus-recipients` | 4 groups passed; delegated deadlines, completed contributors, direct review stage changes and overlapping reviewer/coordinator audiences |
| `npm run verify:independent-tasks` | 27 groups passed; existing workflow/permissions/financial attribution regressions |
| `node scripts/verify-notifications-ui.cjs` | 3 groups passed; local Edge, fixture API, light/dark and mobile/desktop |
| `git diff --check` | Passed |
| Separate lint command | Not available in either package |
| Production delivery / DNS | Not executed; requires external configuration |

The notification suite's first run exposed an outbox timing issue: records queued during a worker pass had a timestamp slightly later than that pass's cutoff. Queued deliveries now use the notification's persisted creation time, so committed events can be delivered in that same pass. Its full rerun passed. The original independent-task suite initially passed 20 groups and failed an on-time earning assertion because its hardcoded 2026-11-05 deadlines had expired; fixture deadlines now use a date seven days after the test starts. Its complete rerun passed all 27 groups without changing financial calculations or weakening the assertions.

Windows sandbox account-information restrictions required running the two database-backed suites outside the sandbox. Both continued to use disposable local databases, with outbound email disabled or mocked. Existing Mongoose index/deprecation warnings and Vite's large-bundle warning remain unrelated to this change.

Provider protocol references: [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Remaining limitations and production verification

| Readiness | Scope |
| --- | --- |
| Implemented and verified locally | Notification matrix above, preferences, templates, persistent queue/deduplication, retries, webhook signature processing, delivery diagnostics, scheduler and petty cash summaries |
| Implemented; external configuration required | Real sending key, verified sender domain, backend environment/deployment, webhook signing secret/registration and deliberate rollout enablement |
| Not implemented | Invoice overdue emails (no invoice due-date field); automatic backfill of every missed daily digest after a long service outage; migration of separate legacy client transactional emails into this notification outbox |
| Not verified in production | Inbox delivery, live provider quotas/domain permissions, Render uptime and actual registered webhook callbacks |

- Real sender-domain verification, key permissions, sending quota, inbox placement, actual Render uptime and webhook registration require external configuration/verification.
- Invoice records have no payment due-date field. Automatic overdue-invoice alerts were deliberately not fabricated. No client payment chase is sent.
- The petty cash daily summary covers the previous complete local calendar day. A service outage longer than a day does not automatically backfill every missed daily summary. The financial activity records remain available in the app.
- Financial calculations and existing fund-management authorization are preserved. The digest reports recorded transactions/current balances; it is not a replacement accounting ledger.
- The reminder scanner currently uses the existing collections directly; larger installations should introduce indexed due-date batches. Application-level deduplication is permanent, but provider-side exactly-once guarantees are limited by the provider's documented retention window.
- Production delivery has not been tested, and no real staff/MD email was sent by verification.
