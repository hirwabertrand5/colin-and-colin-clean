# Profitability and sign-in updates

13 November 2026. Implemented and verified in the local checkout. Production has not been deployed or measured.

## Reporting behavior

- Named periods and custom ranges use `APP_TIMEZONE`, defaulting to `Africa/Kigali`. Start boundaries are inclusive and end boundaries exclusive. Previous quarter and previous year labels match their actual windows.
- Matter contract values and active matter counts use system entry timestamps. Invoice billing and expenses use system entry timestamps. Collections use `paidAt`, with an explicit `updatedAt` fallback for legacy invoices.
- Payment proof replacement and invoice document uploads preserve the recorded payment timestamp. New indexes support payment and entry date reads.
- Refunds belong to their refund date. Receivables show balances at the report end, including earlier entries and invoices paid after that end.
- Staff attributed fees use recorded work completion dates and the existing earnings calculation. Completed matters count in the period of their last completed action. Active and overdue counts use matter entry dates; overdue deadlines are capped at the report end and current time. Current status is used because historical matter status snapshots are unavailable.
- Retainers retain statement, receipt and performed-work dates. Later receipts do not reduce earlier report balances.
- All time applies no period restriction in the API. The profitability dropdown now uses the shared Firm Reports presets (see [follow-up performance changes](dashboard-and-workflow-speed.md)). Missing dates cannot be attributed to a bounded period.

The page keeps filters visible, hides old-period results during loading, cancels superseded requests, validates custom dates and supports refresh/error recovery. Staff reports load only on the staff tab and skip unrelated financial summaries and client analytics. Cards, tables and controls use consistent sizing, with contained horizontal table scrolling on smaller screens. Retainer detail is expandable below the firm summary.

## Sign-in

Normal authentication performs one indexed account read and password verification, with no database writes or password rehashing. Existing stronger hashes remain intact. Stale disabled-lockout fields are cleared only when present. Email addresses are normalized, and malformed inputs, wrong passwords and inactive accounts are rejected.

The login screen starts backend connection setup while credentials are entered and prepares dashboard code when the password field is focused. Authenticated dashboard data still requires successful sign-in. Duplicate submissions are prevented.

## Verification

- Frontend production build and backend TypeScript compilation passed.
- Disposable MongoDB HTTP checks passed for every UI period, Kigali midnight, adjacent boundaries, invalid/reversed custom dates, leap days, daylight-saving boundaries, payment/refund timing, reconciled rollups, staff counts and retainer balances.
- Five real local cost-10 login requests took **474, 86, 95, 96 and 91 ms**, with one account read and no writes per request. A cost-12 request took **346 ms** and preserved its stronger hash.
- Browser checks passed for rapid switching with deliberately reordered responses, custom dates, search, pagination reset, All time, refresh, failure recovery, desktop/mobile layouts and dark mode. Final login navigation took **252 ms** with a synthetic 120 ms authentication response. No frontend runtime errors were observed.

These local measurements do not establish production latency; hosting startup, database distance and network conditions still affect real sign-in time.

Reproduce from the project root:

```text
npm.cmd run build
npm.cmd --prefix colin-backend run verify:profitability
node scripts/verify-profitability-ui.cjs
```

Browser verification saves screenshots in `build/verification` and stops its local server and browser afterward. Database verification uses only the existing local MongoDB test binary and a disposable database; it does not load production credentials.
