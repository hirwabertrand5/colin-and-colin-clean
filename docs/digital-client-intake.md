# Digital client intake portal

## Delivered behavior

The existing **Client Intake & Prospects** page now has **Prospects**, **Client Submissions**, and **Intake Links** tabs. Authorized staff can generate an invitation, copy its secure URL, send it through the existing Resend integration, check its status, revoke it, or regenerate it. Raw tokens are shown only when generated and remain in page memory. Regeneration is necessary to obtain a new copy after leaving the page; it invalidates the previous token.

The public `/intake/form/:token` page collects Individual or Company identification, repeatable relevant parties and their relationships, legal enquiry and objectives, the applicable Articles of Association questionnaire, supporting documents, and a versioned notice acknowledgment. It includes a review step and a receipt reference. The ten questionnaire groups cover company details, share capital and shareholders, shareholder meetings, governance, directors, conditional Company Secretary details, executive management, banking authority, amendments, and other corporate matters. Ownership below or above a combined 100% produces a review warning; each individual percentage must remain between 0 and 100.

Staff can inspect all submitted answers and private documents, review possible duplicates, save administrative classifications and ownership, record official-use details, keep internal notes, request clarification, accept, or reject with a reason. Official-use fields include consultation date, attending counsel, previous client status, referral, verified client name, and an existing signature/dated-record reference. No electronic-signature service is introduced. Clarification uses a separate, hashed, seven-day, single-use token at `/intake/clarification/:token`; original submitted answers remain intact and replies are appended to the review history.

Acceptance calls the same prospect creation function as manual entry. It creates exactly one **Inquiry** prospect with the existing checklist, SLA, ownership, source reference, and an `intakeSubmissionId`. Acceptance does not create a matter. Full structured answers remain in the linked submission instead of being flattened or copied into redundant prospect fields. Matter type is resolved from the existing legal-service tree, preserving litigation, labor and transactional classifications during conversion. The prospect links to the submission; converted matters also expose the original submission and link its files into the normal Documents view without copying stored bytes.

## Generate intake link dialog

The invitation dialog supports both application themes with grouped client/enquiry, ownership and link-preference sections, a live summary on desktop, and visible footer actions on mobile. It offers 3/7/14/30-day presets or a custom 1?30-day duration, inline email/expiry validation, and a copy/email confirmation screen. Entries survive settings retries, privacy setup, and failed generation requests.

Investigation identified three reasons a filled form could remain unavailable: privacy approval was indicated outside the dialog; configuration and optional staff requests were coupled so either failure left configuration unset; and the staff service used a different fallback API port. Configuration and staff now load independently, staff uses the shared API URL, and the dialog explains each blocker with an appropriate retry or privacy-review action. An authorized manager can complete privacy setup from within the dialog and resume the invitation. An unavailable optional staff list does not block generation. The server preserves the privacy approval requirement, returns a specific `NOTICE_APPROVAL_REQUIRED` code, and rejects invalid expiry values including zero.

## Workflow safeguards

The existing server and frontend stage configuration are retained, including both Quotation and Quotation Preparation. Inspection found missing backend enforcement of the configured mandatory key actions and conflict decision, and partial updates that failed full-record validation. The implementation now:

- Validates partial edits against the stored prospect, preserving unrelated information, assignment history, follow-ups and clocks.
- Requires persisted current-stage mandatory checklist completion before forward progression, and prevents jumping over configured stage orders. The existing quotation variants share order 4; both remain available.
- Requires a persisted Cleared conflict decision before leaving Conflict Check.
- Starts each new stage with its own canonical, unchecked checklist.
- Requires persisted conflict clearance and the existing Engagement checklist, including signed engagement and onboarding verification, before conversion.
- Records server-issued conversion verification and requires it before creating an Active Matter. A request cannot supply this verification field itself.

Non-conversion and temporary closure continue through the existing implementation. Existing linked matters are retained. A legacy prospect marked Converted without a matter or verified requirements must return to Engagement and complete verification; deployment does not silently invent clearance for historical records. Checklist completion is an authorized staff attestation, as in the existing application; uploaded signature evidence is not independently verified by software.

## Database changes

New Mongoose models use the existing MongoDB connection:

| Model | Purpose / indexes |
| --- | --- |
| `ClientIntakeLink` | SHA-256 token hash, token version, invitation, assignments, expiry/revocation/open/submission timestamps, upload budget, immutable notice snapshot. Unique reference and token hash; creator/assigned staff date indexes. |
| `ClientIntakeSubmission` | Validated structured form, acknowledgment snapshot/time, staff administration and official-use fields, status, review/clarification history, duplicate acknowledgment, linked prospect. Unique invitation and reference; contact/identity lookup indexes. |
| `ClientIntakeAttachment` | Existing GridFS storage reference, original name, MIME type, size, section, invitation/token version, submission, matter and upload timestamps. Storage ID excluded from normal query results. |
| `ClientIntakeSettings` | One versioned privacy notice, privacy contact, retention statement, management approval and default expiry. |
| `ClientIntakeRate` | Shared, hashed public request counters. Unique key; expiry TTL index. |

`Prospect` gains a unique sparse `intakeSubmissionId` plus server-written conversion verification fields. `Case` gains `intakeSubmissionId`. Existing audit entries gain invitation/submission references. Existing normal Document records reference authorized intake download endpoints after conversion. No migration rewrites existing client records; Mongoose creates the new indexes under the application's normal index policy. Ensure production index creation is enabled or explicitly create the schema indexes through the existing operational process.

## API

All paths below are relative to `/api/digital-intake`.

| Method | Path | Access / behavior |
| --- | --- | --- |
| GET / PUT | `/configuration` | Staff reads; intake managers approve/version notice and retention settings. |
| GET / POST | `/links` | Scoped invitation list / secure generation. |
| POST | `/links/:id/send` | Send invitation; requires current raw token returned at generation. |
| POST | `/links/:id/regenerate` | Rotate token and expiry; invalidate previous token. |
| POST | `/links/:id/revoke` | Revoke an unsubmitted invitation. |
| POST | `/public/form` | Validate token, record opened status, return only public form configuration. |
| POST | `/public/files` | One validated multipart attachment per request. |
| DELETE | `/public/files/:id` | Remove an owned, unsubmitted attachment. |
| POST | `/public/submit` | Atomic final submission; concurrent retries return the same receipt. |
| GET | `/submissions` | Scoped submission summaries. |
| GET | `/submissions/:id` | Full authorized review with files and possible duplicates. |
| PUT | `/submissions/:id/review` | Save notes, missing information, classification, ownership and official-use details. |
| POST | `/submissions/:id/request-information` | Issue a secure clarification URL and attempt email delivery. |
| POST | `/public/clarification` | Validate separate clarification token; return request text and reference only. |
| POST | `/public/clarification/reply` | Save one response and invalidate its token. |
| POST | `/submissions/:id/accept` | Atomic, idempotent creation of one Inquiry prospect. |
| POST | `/submissions/:id/reject` | Record rejection reason and close review. |
| GET | `/files/:id` | Authenticated, authorized private download; always attachment/no-store. |

Public tokens travel in `X-Intake-Token`, not API URL query parameters. Staff requests use the existing bearer authentication. Staff creators/assigned staff can access their invitations; existing senior management roles can oversee intake. Assigned matter team members can access original submissions and files after conversion. Duplicate suggestions are permission-filtered, use contact/identity matches, and never automatically merge records based on names.

## Security and operational limits

- Tokens contain 32 cryptographically random bytes; only their SHA-256 hashes are stored. Expiry is explicitly enforced; database TTL is not used to decide validity.
- Invitation expiry defaults to seven days and supports 1–30 days. Submitted invitations cannot be regenerated or reused for another final submission.
- Transactions serialize final submission and acceptance. Unique indexes enforce one submission per link and one prospect per intake. Optimistic concurrency protects staff review changes. In-app notifications are deduplicated; email/notification failure does not undo saved information.
- Public JSON is capped at 256 KiB, including requests without Content-Length. Rate counters are shared through MongoDB: 180 requests per IP/method/window, 100 per token/method/window, and 40 per upload token/method/window; windows are ten minutes. Counters contain hashes and expire automatically.
- PDF, DOC, DOCX, JPEG and PNG uploads require matching allowed extension/MIME and signature checks. Maximum 10 MiB/file, 20 files and 100 MiB per invitation. Upload budget remains cumulative across token regeneration.
- GridFS files are explicitly marked restricted. Existing public `/uploads/:id` denies those objects even if a storage ID is guessed. Private downloads require intake or assigned matter access and use attachment disposition, no-store and nosniff. Existing ordinary uploads retain their existing behavior.
- All submitted objects are reconstructed from whitelisted schema fields; client workflow status, assignments and arbitrary IDs are ignored. Output uses React text rendering and HTML escaping in emails. No sensitive contents or raw tokens are written to intake audit entries.
- Vercel SPA rewrites cover direct public links. Intake pages use no-store, no-referrer, frame-denial and restrictive frame/base/form policies. The API also sends no-store/no-referrer/nosniff. Tokens are bearer credentials: share only with the intended recipient. Infrastructure request logging must redact `/intake/form/*` and `/intake/clarification/*` paths; those frontend URL paths necessarily contain tokens.
- Draft saving is deliberately absent. Answers remain in page memory until final submission; selected files upload immediately. Closing the page loses unfinished answers. Regeneration excludes files uploaded under the former token version.
- Signature checking is not malware scanning. Downloads are forced as attachments. Use the firm's existing endpoint protection and approved document-inspection policy; no new scanning service was introduced.

## Configuration before client use

No deployment, production environment changes, or live client data changes were performed.

1. Set backend `PUBLIC_CLIENT_URL=https://app.colinandcolin.com` explicitly. Otherwise public URLs default to the canonical firm domain; an obsolete Vercel preview in CLIENT_URL is ignored. Localhost CLIENT_URL remains available for development. Existing local configuration pointed at an older Vercel address, so do not rely on that fallback. HTTPS is required outside localhost development. The same public origin is allowed by the backend CORS configuration.
2. Retain existing frontend API configuration (`VITE_API_URL`, or the application's existing backend URL fallback), JWT configuration, MongoDB Atlas connection and Resend `RESEND_API_KEY` / `EMAIL_FROM`. Intake reuses them. MongoDB transactions require a replica set, as provided by Atlas.
3. Confirm Render `TRUST_PROXY_HOPS` matches the actual trusted proxy chain (default 1 in production); incorrect configuration affects IP rate limits. Keep ingress and API HTTPS enabled.
4. Open Intake Links → Privacy notice. Authorized management must supply and approve the notice, contact and retention statement before any new client link can be generated. Update the notice version when approved wording changes. Existing invitations retain the exact notice they originally presented.
5. Apply the firm's approved retention schedule to abandoned uploads, expired/revoked invitations, rejected submissions, identity documents and backups through its operational retention process. There is intentionally no invented legal retention period or automatic destructive cleanup. MongoDB TTL deletes only rate counters. Files removed before submission are deleted from GridFS; failed cleanup can leave a private orphan for operational reconciliation.

Rwanda's official data-protection guidance requires the collection notice to describe processing and relevant rights, and addresses cross-border storage/transfer and purpose-based retention. Management should confirm lawful basis, recipients/processors, client rights/contact process, storage location, any required cross-border authorizations, and the firm's retention schedule before approving production wording. See the official [processing and quality provisions](https://dpo.gov.rw/dpp-law/processing-and-quality-of-personal-data), [controller and processor obligations](https://dpo.gov.rw/dpp-law/obligations-of-the-data-controller-and-the-data-processor), and [transfer, storage and retention provisions](https://dpo.gov.rw/dpp-law/sharing-transferstorage-and-retention-of-personal-data). This implementation records approval; it does not certify compliance or make the firm's policy decisions.

The referenced six-page intake PDF was not present among the supplied attachments. The blank form implements the detailed field inventory in the implementation brief. Exact PDF-label parity remains subject to comparison with the original PDF; no sample person's information was inserted into the application.

## Modified file map

| Area | Files |
| --- | --- |
| Shared form/classification | `colin-backend/src/config/digitalIntakeSchema.ts`, `colin-backend/src/config/legalServicesTree.ts`, `src/constants/legalServicesTree.ts` (re-export of unchanged catalogue) |
| Backend | `colin-backend/src/models/digitalIntakeModel.ts`, `routes/digitalIntake.ts`, `services/digitalIntakeService.ts`, `services/digitalIntakeValidation.ts`, `services/intakeDocumentService.ts` |
| Existing backend integration | `colin-backend/src/app.ts`, `controllers/prospectController.ts`, `models/prospectModel.ts`, `models/caseModel.ts`, `models/auditLogModel.ts`, `services/fileStorageService.ts` |
| Public UI | `src/components/public/PublicIntakeForm.tsx`, `IntakeFormFields.tsx`, `digitalIntake.css`, `src/services/digitalIntakeService.ts` |
| Staff UI | `src/components/cases/DigitalIntakeWorkspace.tsx`, `GenerateIntakeLinkDialog.tsx`, `IntakeProspects.tsx`, `ProspectWorkspace.tsx`, `ProspectWorkflowTab.tsx` |
| Existing document integration | `src/components/cases/CaseWorkspace.tsx`, `CaseManagementTab.tsx`, `src/components/tasks/TaskDetail.tsx`, `src/services/apiConfig.ts`, `caseService.ts`, `prospectService.ts`, `userService.ts` |
| Routing/security | `src/App.tsx`, `index.html`, `vercel.json` |
| Verification/documentation | `colin-backend/src/scripts/verifyDigitalIntake.ts`, `colin-backend/package.json`, `scripts/verify-digital-intake-ui.cjs`, this document |

## Verification

Backend checks run real Express handlers, Mongoose transactions and GridFS against a disposable MongoDB replica set. They do not load `.env` or use `MONGO_URI`, suppress outbound email and use synthetic `test.invalid` records:

```powershell
cd colin-backend
npm.cmd run verify:digital-intake
```

Verified result: **16 backend verification groups passed**, the backend production build and focused frontend TypeScript check passed, and the frontend production build passed. The frontend build retains the existing large-chunk warning. **Eight local browser verification groups passed** for the flows described below.

The 16 verification groups cover public URL fallback and HTTPS validation; Resend setup, error classification, confirmed send and retry deduplication; staff/notice permissions; unpredictable hashed tokens; expired/revoked/regenerated/invalid links; Individual/Company validation; document ownership and size limits; upload signatures and public storage denial; simultaneous final submissions; scoped review and download access; notification delivery with email disabled; administrative review and single-use clarification; simultaneous acceptance; complete questionnaire answer preservation and duplicate review; rejection; manual prospect editing/follow-up/reassignment; all configured stages and conversion guards; private file linking; non-conversion/temporary closure; ordinary file regression; audit token exclusion; and persistent rate limits.

Frontend production build and focused TypeScript check:

```powershell
npm.cmd run build
node colin-backend/node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target ES2020 --module ESNext --moduleResolution bundler --skipLibCheck --allowSyntheticDefaultImports --types vite/client src/components/public/PublicIntakeForm.tsx src/components/cases/DigitalIntakeWorkspace.tsx src/components/cases/GenerateIntakeLinkDialog.tsx src/services/digitalIntakeService.ts
node scripts/verify-digital-intake-ui.cjs
```

The local browser script uses installed Edge (or `INTAKE_TEST_BROWSER`) with synthetic API fixtures and the production build. It checks conditional identification, required fields, repeatable parties, questionnaires/shareholders, upload progress and final review/submit, 390px mobile and 1440px desktop layout, link-error and clarification states, staff link-generation/tab controls, light/dark dialog themes, mobile footer visibility, optional staff outages, configuration retry, privacy approval with draft preservation, inline validation, and successful generation retry, anonymous direct-link refresh, and missing-email setup with safe error recovery. It saves synthetic screenshots under ignored `node_modules/.cache/intake-browser-*`. Backend integration separately tests the real API/file operations; browser fixtures do not send mail or contact production.

## Public-link and email troubleshooting

The reported old Vercel link was generated from the legacy CLIENT_URL fallback. Public links now use PUBLIC_CLIENT_URL explicitly, or the stable https://app.colinandcolin.com domain. An old preview address is not selected implicitly. An already-copied old hostname cannot be repaired by changing the database; after deploying the routing changes, generate or regenerate the invitation and copy its new URL.

The frontend Vercel configuration explicitly sets framework vite, the build command, outputDirectory build (matching vite.config.ts), and the standard /(.*) rewrite to /index.html. This lets direct /intake/form/:token and /intake/clarification/:token visits reach React, including refresh and anonymous visits. Existing asset files are served normally by Vercel. This follows [Vercel's Vite guidance](https://vercel.com/docs/frameworks/frontend/vite). A removed/unassigned hostname still requires a valid deployment/domain assignment in Vercel; a source-code rewrite cannot restore a deleted deployment. Requests to the two public hosts from this environment timed out or failed DNS, so the existing live routing could not be independently confirmed.

The available backend .env contains neither RESEND_API_KEY nor EMAIL_FROM. This proves local email setup is incomplete; it does not establish which variables exist on the separate live Render service. The previous generic failure hid this distinction. The authenticated configuration response now includes safe delivery readiness (no secret values), and invitation sends report a specific code and corrective message for missing configuration, invalid sender/credentials, unverified domain, test-recipient restrictions, sending limits, provider errors and invalid recipients. Clarification requests expose the same safe diagnostics. Only a provider response with an email ID counts as a successful send; provider acceptance does not guarantee inbox delivery. Successful invitation sends record their token version, and provider idempotency keys protect retries from duplicate invitations.

For live use, the administrator must deploy this frontend configuration to the correct Vercel project, deploy the backend changes to Render, and configure the existing Render service:

- PUBLIC_CLIENT_URL=https://app.colinandcolin.com (or an explicitly chosen active frontend domain).
- RESEND_API_KEY: a sending API key from the firm's Resend account.
- EMAIL_FROM: a valid sender on a domain verified in that same Resend account, in mailbox or Display Name <mailbox> form.

Copy the required variable names from colin-backend/.env.example; enter the real secret only in Render's environment settings. No email key was invented, placed in the frontend, or written to tracked files. Resend requires an API key and a verified domain for normal client delivery; see its [Node.js setup](https://resend.com/docs/send-with-nodejs) and [error reference](https://resend.com/docs/api-reference/errors).

After configuration, use Recheck email setup in the generated-link screen, then Send via email. A failed send preserves the invitation and copied link. The screen also provides Open client form to check the destination. The verification suite simulates actual Resend SDK responses for missing setup, invalid key, unverified domain, test restrictions, quota, provider errors, missing confirmation IDs, successful send, and retry deduplication without contacting Resend or sending mail. Browser tests verify anonymous direct-link refresh, missing-email setup/recheck, detailed provider failures, and retry success.
