# Sidebar navigation performance

10 November 2026. Implemented in the local checkout; production deployment and production latency measurements have not been performed.

## Improvements

- All sidebar levels, administration links, quick actions, and header links use the same navigation preparation. Pointer hover starts downloading page code; keyboard focus and touch/pointer interaction prepare the destination too.
- Prepared API reads are kept only in browser memory for five seconds and consumed by the next matching page request. Concurrent GETs share the network request and receive independent response bodies. Ordinary repeat reads fetch fresh data.
- Saving through the application clears prepared reads before and after the write. Logout, account changes, and authentication failures clear them too. Failed speculative loads do not block normal retries. No-store reads retain their existing behavior.
- Preparation is limited to three API reads at a time and 32 short-lived entries. Moving to another menu replaces queued work. Data saver and slow 2G connections skip preparation.
- Financial pages fetch expense data in batches of up to 100 matters/funds per request. For 100 matters, this reduces the expense request count from 100 to one. The existing permission rules, per-group sorting, and 500-expense limit are retained. Frontends fall back to the individual endpoints during rolling deployments.
- Firm reporting reuses one matter read instead of five separate reads for related report sections. Independent expense and invoice reads run together. Calculations and date/member scopes remain unchanged.
- Billing/finance and analytics start independent data requests together. Switching between supported People & Capacity views avoids fetching unchanged data again.
- Client Experience data loads when switching into an experience submenu, including when coming from another client-report view. This keeps the faster navigation accurate.
- Client-report pages now import their existing sorting helper correctly; the missing import previously caused those destinations to fail while rendering.
- Active Matters avoids per-row diagnostic calculations and console output in production. The sidebar no longer sends two initial unread-notification count requests.

## Validation and timing limits

**Final result:** all 180 role-specific menu destinations passed, with no browser runtime errors. All loaded below one second in the controlled local audit:

| Measurement | Result |
| --- | --- |
| Fastest destination | 44 ms |
| Median destination | 72 ms |
| 95th percentile | 171 ms |
| Slowest destination | 303 ms |
| Expand/collapse menu groups checked | 19 |

The audit preserves the existing permission redirect for associates using the header's New Matter link. The final targeted retry checked that redirect after the other 179 destinations had passed.

The audit script discovers menu links from the actual rendered sidebar and visits their destinations, including nested query-based views. It covers managing-director, executive-assistant, and associate navigation, and writes its per-destination results to `sidebar-navigation-audit.json`.

Browser measurements use the production bundle, synthetic records, intercepted API responses delayed by 60 ms, and 220 ms of pointer preparation before clicking. They measure click-to-loaded-content in that controlled environment. They cannot establish a universal one-second production guarantee; hosting, connection latency, server cold starts, data volume, and database latency still need live measurement after deployment.

Build and TypeScript validation passed. Request-layer checks passed for concurrent reads, body isolation, fresh repeat reads, mutations, late-response races, retries, account separation, and no-store behavior.

The isolated financial check **passed**: optimized report JSON exactly matches the previous committed handler for invoice-date/payment-date bases and all-staff/individual-staff scopes. The expense check also **passed**, comparing batched responses with the existing individual endpoints, including more than 500 expenses, empty groups, ordering, permissions, and invalid inputs.

## Run checks

From the project root:

```text
npm run build
node scripts/verifyNavigationRequests.mjs
```

From `colin-backend`:

```text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/tsx/dist/cli.mjs src/scripts/verifyNavigationPerformance.ts
```

With the production build served locally on `http://127.0.0.1:5178`, run `node scripts/verifySidebarNavigation.cjs` from `colin-backend`.

Deploy both frontend and backend for the full improvement. No production records were changed during these checks.
