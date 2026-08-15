// lib/serve.js
// Assembles a store's dashboard payload, preferring Postgres over live Shopify.
//
// Query cost per store, per dashboard load:
//
//   before          7  (sales, sessions, referrers, 2x campaigns, 2x comparison)
//   after, DB hit   0  for Overview / Net Sales / Conversion / AOV / Funnel
//                   1  when the Traffic tab is open
//                   2  when the Campaigns tab is open
//
// The timeseries half — which every tab needs — comes from synced daily rows.
// Referrer and campaign breakdowns are still live because they're dimensional
// rather than daily, but they're only fetched for the tab actually being viewed.

import { coverage, readDailyMetrics, dbAvailable } from "./db";
import { aggregateRows } from "./sync";
import { cachedShopifyQL } from "./shopifyql";
import {
  fetchStoreData,
  pickGranularity,
  daysBetween,
  referrersQuery,
  campaignSessionsQuery,
  campaignSalesQuery,
  utmFallbackSessionsQuery,
  utmFallbackSalesQuery,
  reshapeReferrersPublic,
  reshapeCampaignsPublic,
  SESSIONS_DATA_FLOOR,
} from "./queries";

// How stale the synced data may be before we stop trusting it for a range that
// runs up to yesterday. Two days of slack absorbs a missed nightly run.
const MAX_STALENESS_DAYS = 2;

function ratesFrom(agg) {
  const rate = (a, b) => a.map((v, i) => (b[i] > 0 ? parseFloat(((v / b[i]) * 100).toFixed(2)) : 0));
  return {
    acr: rate(agg.ca, agg.se),
    ccr: rate(agg.rc, agg.se),
    c2c: rate(agg.rc, agg.ca),
  };
}

function pad(arr, n) {
  return Array.from({ length: n }, (_, i) => (arr && arr[i] != null ? arr[i] : 0));
}

/**
 * Can Postgres answer for this store and range?
 * Returns null when it can't, so the caller falls back to live queries.
 */
async function dbSlice(store, from, to, granularity) {
  // A database problem must never take the dashboard down — it degrades to
  // live Shopify queries instead. Returning a `reason` rather than a bare null
  // means a silent fallback can be diagnosed from the API response instead of
  // by guessing which of four conditions tripped.
  let cov;
  try {
    cov = await coverage(store.key, from, to);
  } catch (err) {
    console.error(`[serve] coverage lookup failed for ${store.key}:`, err.message);
    return { reason: `coverage query failed: ${err.message}` };
  }
  if (!cov.days) return { reason: `no rows for ${store.key} between ${from} and ${to}` };

  // If the range runs close to today, require the sync to be roughly current.
  const staleness = cov.maxDay ? daysBetween(cov.maxDay, to) - 1 : Infinity;
  if (staleness > MAX_STALENESS_DAYS) {
    return { reason: `synced only to ${cov.maxDay}, ${staleness} days behind ${to}` };
  }

  let rows;
  try {
    rows = await readDailyMetrics(store.key, from, to);
  } catch (err) {
    console.error(`[serve] read failed for ${store.key}:`, err.message);
    return { reason: `read failed: ${err.message}` };
  }
  if (!rows.length) return { reason: `coverage saw ${cov.days} days but the read returned none` };

  return { agg: aggregateRows(rows, granularity), cov };
}

export async function fetchStoreDataServed(store, range, compare, opts = {}) {
  const granularity = pickGranularity(range.from, range.to, opts.granularity);
  const include = opts.include || { traffic: true, campaigns: true };
  const warnings = [];

  if (!dbAvailable() || opts.forceLive) {
    const live = await fetchStoreData(store, range, compare, opts);
    return { ...live, source: "live" };
  }

  const primary = await dbSlice(store, range.from, range.to, granularity);
  if (!primary.agg) {
    // Nothing usable synced yet — fall back to live so the dashboard still works.
    const live = await fetchStoreData(store, range, compare, opts);
    return {
      ...live,
      source: "live-fallback",
      warnings: [
        ...live.warnings,
        {
          store: store.key,
          dataset: "sync",
          code: "NOT_SYNCED",
          message:
            `Served live from Shopify instead of the synced database — ${primary.reason}. ` +
            "Run /api/sync to backfill this range.",
        },
      ],
    };
  }

  const cmp = compare?.from && compare?.to
    ? await dbSlice(store, compare.from, compare.to, granularity)
    : null;

  if (compare?.from && !cmp?.agg) {
    warnings.push({
      store: store.key,
      dataset: "comparison",
      code: "NOT_SYNCED",
      message: `The comparison range isn't synced yet (${cmp?.reason || "no data"}) — comparison figures will read as zero until it is.`,
    });
  }

  const a = primary.agg;
  const n = a.labels.length;
  const c = cmp?.agg;
  const rates = ratesFrom(a);
  const cRates = c ? ratesFrom(c) : { acr: [], ccr: [], c2c: [] };

  // ── Dimensional breakdowns, only for the tab being viewed ────────
  let rf = [];
  let ut = [];
  let uc = [];

  const sFrom = range.from < SESSIONS_DATA_FLOOR ? SESSIONS_DATA_FLOOR : range.from;

  if (include.traffic) {
    try {
      const res = await cachedShopifyQL(store, referrersQuery(sFrom, range.to), opts);
      rf = reshapeReferrersPublic(res);
    } catch (err) {
      warnings.push({ store: store.key, dataset: "referrers", code: err.code || "ERROR", message: err.message });
    }
  }

  if (include.campaigns) {
    let sessionsRes = { failed: true, columns: [], rows: [] };
    let salesRes = { failed: true, columns: [], rows: [] };
    try {
      sessionsRes = await cachedShopifyQL(store, campaignSessionsQuery(range.from, range.to), opts);
    } catch (err) {
      warnings.push({ store: store.key, dataset: "campaignSessions", code: err.code || "ERROR", message: err.message });
    }
    try {
      salesRes = await cachedShopifyQL(store, campaignSalesQuery(range.from, range.to), opts);
    } catch (err) {
      warnings.push({ store: store.key, dataset: "campaignSales", code: err.code || "ERROR", message: err.message });
    }

    const unusable = (r) => r.failed || (r.rows || []).length === 0;
    if (unusable(sessionsRes) && unusable(salesRes)) {
      try {
        sessionsRes = await cachedShopifyQL(store, utmFallbackSessionsQuery(sFrom, range.to), opts);
      } catch (err) {
        warnings.push({ store: store.key, dataset: "campaignSessionsFallback", code: err.code || "ERROR", message: err.message });
      }
      try {
        salesRes = await cachedShopifyQL(store, utmFallbackSalesQuery(range.from, range.to), opts);
      } catch (err) {
        warnings.push({ store: store.key, dataset: "campaignSalesFallback", code: err.code || "ERROR", message: err.message });
      }
    }

    const shaped = reshapeCampaignsPublic(sessionsRes, salesRes);
    ut = shaped.campaigns;
    uc = shaped.channels;
  }

  return {
    source: "db",
    granularity,
    warnings,
    coverage: primary.cov,
    data: {
      labels: a.labels,
      buckets: a.buckets,
      s: a.s, gs: a.gs, ts: a.ts, dc: a.dc,
      or: a.or, av: a.av, cv: a.cv,
      se: a.se, ca: a.ca, rc: a.rc, ck: a.ck,
      acr: rates.acr, ccr: rates.ccr, c2c: rates.c2c,
      // Comparison series, aligned by position against the primary buckets
      sp: pad(c?.s, n),
      orp: pad(c?.or, n),
      ap: pad(c?.av, n),
      cvp: pad(c?.cv, n),
      sep: pad(c?.se, n),
      cap: pad(c?.ca, n),
      rcp: pad(c?.rc, n),
      ckp: pad(c?.ck, n),
      acrp: pad(cRates.acr, n),
      ccrp: pad(cRates.ccr, n),
      c2cp: pad(cRates.c2c, n),
      rf, ut, uc,
    },
  };
}
