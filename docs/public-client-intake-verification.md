# Native public client intake: verification and release status

## User-confirmed production address

The firm uses **https://colin-and-colin.vercel.app/login** for staff. The native client form belongs at **https://colin-and-colin.vercel.app/intake/form/:token**, without login. The backend default, local environment and configuration example have been corrected to this origin. Explicit PUBLIC_CLIENT_URL still takes precedence; production should set PUBLIC_CLIENT_URL and CLIENT_URL to https://colin-and-colin.vercel.app.

The older custom domain below was investigated because of the previous incorrect recommendation. It is not the production target, and updating or migrating its hosting is not required for this task. The main Vercel deployment already contains the native route. An earlier API CORS preflight allowed its origin; the latest follow-up API requests timed out, so live response reception remains unverified. The t62y alias is secondary and is not used as the new invitation default.

## Historical deployment comparison — 1 November 2026

The native form already exists in `src/components/public/PublicIntakeForm.tsx`. Its six-step flow uses the existing invitation, upload, submission, notification, review and prospect services. No duplicate form or third-party form platform was added for this work.

The live domains serve different application versions:

| Address | Observed deployment | Public route / anonymous browser result |
| --- | --- | --- |
| `https://app.colinandcolin.com` | LiteSpeed; entry `/assets/index-aZMbohYL.js` | Entry lacks the intake route and form. Anonymous `/intake/form/deployment-check` redirects to `/login`. |
| `https://colin-and-colin-t62y.vercel.app` | Vercel; entry `/assets/index-1_upvAi1.js` | Entry contains the native form and route. Browser renders its standalone public shell. Live API CORS preflight rejects this origin with HTTP 500 and no allow-origin header. |
| `https://colin-and-colin.vercel.app` | Same Vercel entry as above | Native route and standalone shell present. API CORS preflight allows this origin. |

The Render API's authenticated intake configuration endpoint returns HTTP 401 without credentials. This confirms an authenticated route is present, but does not certify a successful valid invitation or submission.

The previous recommendation selected an unused custom domain serving an older application. That explains its login redirect; it is not a blocker on the user-confirmed main Vercel site. Both frontends return HTTP 200 and an HTML React root; that alone is not evidence the client form is deployed.

The production audit fetched public HTML/JavaScript and CORS OPTIONS responses. Its browser checks blocked **all API requests** and used a diagnostic path with no real invitation. No live invitation was validated, marked opened, or submitted. The unavailable-link message in those Vercel screenshots is caused by the deliberately blocked API; it is not evidence that a valid invitation failed. No live client records were created or modified.

Re-run the read-only audit:

```powershell
node scripts/verify-public-intake-deployment.cjs --browser
```

It writes timestamps, asset hashes, route markers, CORS results and anonymous screenshots under ignored `node_modules/.cache/intake-production-audit`. The audit checks the user-confirmed main Vercel origin as its release target. A failure on a secondary or unused domain is reported but does not fail the active target. A nonzero exit is expected if the active target lacks the form or fails CORS. Its `productionVerified` remains false because these checks do not submit a live form.

## Local fixes

- `App.tsx` now owns the public routes directly. The existing staff application was moved to `StaffApp.tsx` and loads only for staff routes. A public form does not bootstrap staff authentication, load the dashboard module or acquire its sidebar/navigation. Existing user/role type exports are retained.
- Staff session parsing tolerates corrupt or unavailable browser storage. Public API requests use only the invitation header and never attach a staff bearer token.
- Invalid/non-JSON API responses and malformed public form configuration show a recoverable error instead of crashing or rendering a blank page. Network requests and uploads have explicit timeout/retry messages; submission errors preserve answers in page memory.
- Email and telephone checks match backend requirements before leaving the relevant step. Email/telephone input lengths match server limits.
- Public mobile inputs use readable 16px text, 44px touch targets and visible footer actions. Existing multistep review and private document upload behavior is retained.
- The backend CORS allowlist now includes the exact existing `t62y` Vercel alias. It does not allow arbitrary Vercel domains. This fix is local until the backend is deployed.

This change adds no database models, migrations or API endpoints. It reuses the existing intake records, routes, GridFS, notifications and prospect acceptance service. All 138 existing staff route paths were retained during the public/staff application split.

## PDF comparison

The supplied six-page PDF was read directly from the user-provided file. Its sample identity, contact details, company name, engagement narrative, dates and signature were not copied into code or seed data. The PDF's information structure is represented as blank reusable fields:

| PDF section | Existing native form coverage |
| --- | --- |
| Page 1, A: identification | Individual/company choice, separate TIN and representative identity, email, phone, profession/position, optional contact, country through village |
| Page 1, B: relevant parties | Repeatable individual/company records, applicable identity and representative/father field, contacts, address and relationship |
| Pages 1–2, C / case overview | Service classification, inquiry, objectives, background, dates, jurisdictions, circumstances and concerns |
| Pages 2–5: supporting information | All ten Articles of Association groups: company; share capital and shareholders; shareholder meetings; governance; directors; conditional Company Secretary; management; banking; amendments; other corporate matters |
| Supporting documents | Private uploads, section labels, progress, retry/removal, final review and authenticated staff download |
| Page 5: notice | Approved, versioned notice with contact/retention and required acknowledgment; accuracy, confidentiality and no automatic engagement are retained |
| Pages 5–6: official use | Staff-only consultation, counsel, prior-client/referral, verified name and existing signature/date record fields |
| Page 6: return/confirmation | Native submission receipt and staff review replace manual return by email |

The approved notice remains a management-controlled versioned snapshot. The sample PDF does not silently replace approved production privacy wording or create an electronic-signature service.

## Verification

Build and run the existing API suite:

```powershell
npm.cmd run build
cd colin-backend
npm.cmd run verify:digital-intake
```

From the repository root, run the browser suites after both builds:

```powershell
node scripts/verify-digital-intake-ui.cjs
node scripts/verify-public-intake-e2e.cjs
```

The existing browser suite uses synthetic response fixtures for UI regressions. The new end-to-end suite uses the **actual Express application, actual routes, MongoDB transactions and GridFS** on a disposable replica set. It does not load `.env` or use the live `MONGO_URI`; outbound email is disabled and browser access outside localhost is blocked. Only request destinations are redirected to the isolated API; its responses are not mocked.

The new suite checks an anonymous direct visit and refresh even with corrupt staff storage; no dashboard or staff bundle on the public route; individual/company fields; all six steps; multiple parties; every Articles questionnaire field and conditional Secretary group; shareholders; real upload; complete persisted answers, acknowledgment and internal notification; the actual staff Client Submissions list and review modal; acceptance into one Inquiry prospect; no Active Matter; and safe handling of an already-submitted link. Screenshots contain synthetic test data only and remain under ignored `node_modules/.cache/intake-e2e-*`.

It also interrupts the first final submission at the network boundary and confirms the review answers and acknowledgment remain available for a successful retry. The UI regression suite separately checks unexpected HTML, incomplete public configuration and unavailable API states.

Verified locally on 1 November 2026: frontend and backend production builds passed; the focused public-form TypeScript check passed; all 16 backend verification groups and nine UI regression groups passed; and both complete real-API browser verification groups passed, including interrupted submission recovery and actual staff acceptance. The frontend retains its existing large-chunk build warning. These results do not certify production deployment.

## Release still required

No deployment or production configuration change has been performed. Local success is not production completion.

1. Publish the reviewed frontend changes to the existing Vercel project serving https://colin-and-colin.vercel.app, with outputDirectory build and the existing SPA rewrite. The native form already exists on this deployment; newer local error handling and staff-layout isolation still require a release. No custom-domain or DNS migration is required.
2. Deploy the reviewed backend changes to the existing Render service and set PUBLIC_CLIENT_URL=https://colin-and-colin.vercel.app and CLIENT_URL=https://colin-and-colin.vercel.app. Explicitly remove an incorrect old PUBLIC_CLIENT_URL, since explicit configuration overrides the fallback. Preserve MongoDB/JWT/email settings and transaction/index support. The main Vercel origin passed an earlier CORS check, but later API requests timed out; recheck backend availability during release. The t62y allowlist fix supports that secondary alias only.
3. Repeat the read-only deployment audit. Confirm the active Vercel origin contains the native intake route, passes CORS and renders the standalone public shell without redirecting to login.
4. With explicit authorization for a production test, generate a synthetic invitation using an authorized staff account, open and refresh it signed out on mobile/desktop, complete and submit the form, verify the actual staff queue/notification/private file, and accept it into Inquiry. Confirm exactly one prospect and no Active Matter. Handle the synthetic records through the firm's approved cleanup process.

The feature must remain **not verified in production** until step 4 succeeds. No genuine client information should be used for that release check.
