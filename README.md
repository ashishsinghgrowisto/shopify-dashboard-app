# Shopify Portfolio Dashboard (live API version)

Multi-store Shopify analytics: every connected store gets its own tab, plus an
**All Brands** tab that consolidates the whole portfolio. Any date range, any
comparison range, live from Shopify — no CSV exports, no Google Drive.

```
Shopify stores ──► ShopifyQL (Admin GraphQL) ──► Next.js API route ──► React dashboard
   one Admin API         live queries per          parallel fan-out      7 tabs per store
   token per store       store + date range        + smart caching       + portfolio rollup
```

This replaces the Drive/CSV version. Same visual language, but the numbers come
straight from Shopify's analytics engine and the date range is arbitrary.

---

## What you get

**Per store:** Overview · Net Sales · Conversion · AOV & Orders · Funnel · Traffic · Campaigns

**All Brands:** portfolio KPIs, store-vs-store comparison table with deltas,
net-sales-by-store trend, revenue contribution split, conversion-rate ranking,
combined funnel with per-store pass-through rates, and campaigns merged across
stores (with coloured dots showing which brands ran each campaign).

**Date controls:** presets (7/30/90 days, 12 months), free date range, free
comparison range, one-click "previous period" / "previous year", and day/week/month
bucketing.

Ratio metrics (AOV, conversion rate, funnel rates) are **recomputed from summed
components**, never averaged — so a 200-session store can't skew the portfolio
number the way a naive average would.

---

## Before you start: the two Shopify constraints that shape everything

These were verified against Shopify's current docs (Aug 2026). They're the reason
this app is built the way it is.

### 1. You cannot auto-connect every store in your Partner account

There is no Partner-account-wide data access. The Partner API exposes only your own
app installs and payouts — no orders, no sessions, no analytics. Collaborator access
grants admin UI access, not API access. Cross-store analytics in the Shopify admin
exists but is Plus-organization only and has no API.

**Every store needs its own Admin API token.** Two ways to get one:

| Route | Effort per store | Shopify review | Notes |
|---|---|---|---|
| **Admin custom app** (recommended to start) | ~5 min, in the store admin | None | Store owner (or staff with *App development* permission) creates it. Collaborator accounts **cannot**. |
| **OAuth app install link** | One click per store | **Yes** — App Store review required | Public distribution needs review before install on any live store. "Unlisted"/limited-visibility is a post-review setting, not a bypass. Custom distribution is limited to one store, or multiple stores in one Plus org. |

This app supports both: env-var tokens (see below) and the OAuth flow
(`/api/auth/install?shop=…`).

### 2. ShopifyQL needs `read_reports` **and** Level 2 protected customer data access

Shopify applies the customer-data check to the `shopifyqlQuery` field itself, so
even aggregate-only queries are blocked without it. If you see `ACCESS_DENIED`,
this is why — not your query.

- Admin custom apps: request `read_reports`; protected customer data is available
  to custom apps without review (Level 2 for admin-created apps varies by plan).
- Public/partner apps: Level 2 requires a Shopify review, so **request it early**.

### Other limits worth knowing

- **Session metrics start 2022-10-01.** Nothing before that exists, platform-wide.
  The app clamps the range and warns instead of erroring.
- **Analytics redefinitions in Oct 2024** changed `checkout_started` / `checkout_completed`.
  Any year-over-year comparison spanning that date isn't apples-to-apples.
- **Today is partial** and climbs as orders land. Default ranges end *yesterday*.
- **ShopifyQL has its own rate-limit budget**, smaller than the standard GraphQL one
  and usually the first to run out. The app backs off on `windowResetAt`.
- Reports are **not** plan-gated — Basic includes all reports.

---

## Setup

### 1. Get a token for each store

In the store admin: **Settings → Apps and sales channels → Develop apps →
Create an app** → *Configure Admin API scopes* → enable **`read_reports`** →
**Install app** → reveal the **Admin API access token** (`shpat_…`).

Tokens are shown once. Treat them like passwords.

### 2. Configure the stores

Copy `.env.example` to `.env.local` and add one block per store:

```
STORE_1_LABEL=ColorProof
STORE_1_DOMAIN=colorproof.myshopify.com
STORE_1_TOKEN=shpat_xxxxxxxxxxxxx

STORE_2_LABEL=NeumaBeauty
STORE_2_DOMAIN=neumabeauty.myshopify.com
STORE_2_TOKEN=shpat_yyyyyyyyyyyyy
```

Or paste them all as one JSON array in `SHOPIFY_STORES`. Both formats work
together; up to 40 numbered blocks are scanned.

Also set `DASHBOARD_PASSWORD` — the dashboard shows every client's revenue side by
side, so an unprotected public URL exposes all of it.

### 3. Verify the connection before trusting the dashboard

```bash
npm install
npm run dev
```

Open **`/api/diagnose`**. It probes every dataset the dashboard uses, per store,
and tells you exactly which ones work and which columns came back:

```json
{ "probe": "sessions (funnel)", "ok": true, "rows": 8,
  "columns": ["day","sessions","sessions_with_cart_additions", "..."] }
```

A failing probe only disables that part of the dashboard — the rest still renders.
`ACCESS_DENIED` means scopes/protected-customer-data, not a bad query.

### 4. Preview without any store connected

```bash
MOCK_DATA=1 npm run dev
```

Renders the full dashboard with synthetic data for six fictional stores. Also
available per-request as `/api/dashboard?mock=1`.

### 5. Deploy to Vercel

Import the repo, then add the same environment variables in
**Settings → Environment Variables**. Redeploy after adding tokens.

---

## Adding a store later

Add one more `STORE_n_*` block and redeploy. Nothing in the code needs touching —
tabs, colours, consolidation and the comparison table are all derived from the
store registry at runtime.

---

## Architecture

```
lib/stores.js        Store registry from env vars (+ OAuth installs), tokens never sent to the client
lib/shopifyql.js     ShopifyQL client: parseErrors, 429 backoff, ACCESS_DENIED handling, caching, mapLimit
lib/queries.js       Query builders per dataset + reshaping into per-bucket arrays; per-dataset failure isolation
lib/consolidate.js   All-Brands rollup — sums additive metrics, recomputes ratios
lib/token-store.js   Optional KV persistence for OAuth-installed tokens
lib/mock.js          Deterministic synthetic data for demo mode
app/api/dashboard    Fans out across stores, returns per-store + consolidated payload
app/api/diagnose     Per-store, per-dataset connection tester
app/api/auth/*       Shopify OAuth install + callback (HMAC + state verified)
components/Dashboard.jsx   All 7 tabs, store-agnostic, date + comparison controls
middleware.js        Optional basic-auth gate
```

### Caching

Live API on every page load, with a server-side cache keyed by **store + exact
query string** (a shared key would return the wrong store's rows):

- ranges that include today → 5 min (`CACHE_TTL_LIVE`)
- completed ranges → 6 h (`CACHE_TTL_CLOSED`)

**Refresh live data** bypasses the cache. If store count grows past ~15 and page
loads feel slow, the natural next step is a nightly sync into Postgres — the data
layer is already isolated behind `fetchStoreData()`, so only that call site changes.

### Query cost

Per store per load: 5 queries (sales, sessions, referrers, 2× campaigns) plus 2 more
when a comparison range is set. Stores run in parallel (`STORE_CONCURRENCY`),
queries within a store are throttled to 3 at a time.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `ACCESS_DENIED` | Missing `read_reports` scope, or Level 2 protected customer data access not granted. |
| HTTP 401/403 | Token invalid, revoked, or from a different store. |
| Traffic/funnel tabs empty, sales fine | Session metrics unavailable for that range (nothing exists before 2022-10-01). |
| Campaigns tab empty | No UTM-tagged traffic in the range, or the `campaign_*` schemas aren't reachable — the app automatically falls back to UTM dimensions on `sessions`/`sales`. |
| Numbers differ slightly from the admin UI | Partial current day, Oct 2024 metric redefinitions, or reporting time zone. Ranges ending yesterday avoid the first. |
| Slow first load | Live queries across all stores. Subsequent loads hit the cache. |
