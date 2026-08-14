// lib/sync.js
// Pulls daily analytics from Shopify into Postgres.
//
// Why this exists: rendering the dashboard live cost 5-7 ShopifyQL queries per
// store per page load, and every date-range change re-fired the whole fan-out.
// ShopifyQL draws on its own rate-limit budget — smaller than the standard
// GraphQL one and, per Shopify, "usually the first to run out". At 20 stores
// that model collapses.
//
// Syncing daily rows once a day turns that into ~2 queries per store per day
// regardless of how often anyone opens the dashboard, and makes every date
// range a SQL query instead of an API round trip.

import { cachedShopifyQL, mapLimit } from "./shopifyql";
import { salesTimeseriesQuery, sessionsTimeseriesQuery, isoDate, SESSIONS_DATA_FLOOR } from "./queries";
import { ensureSchema, upsertDailyMetrics, recordSyncRun, lastSyncedDay } from "./db";

// Recent days keep changing: late orders land, refunds post, and Shopify's own
// attribution settles. Always re-pull a trailing window rather than trusting
// the first read of a day.
export const RESYNC_TRAILING_DAYS = 7;

// Shopify caps a single ShopifyQL result set, so long backfills are chunked.
const MAX_DAYS_PER_QUERY = 180;

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[$,%\s]/g, ""));
  return isFinite(n) ? n : null;
}

function dayKey(v) {
  const s = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function addDays(iso, n) {
  return isoDate(new Date(iso + "T00:00:00Z").getTime() + n * 86400000);
}

function splitRange(from, to, maxDays) {
  const out = [];
  let cursor = from;
  while (cursor <= to) {
    const end = addDays(cursor, maxDays - 1);
    out.push({ from: cursor, to: end > to ? to : end });
    cursor = addDays(end, 1);
  }
  return out;
}

// Merge the sales and sessions halves into one row per day.
function mergeIntoDays(map, rows, mapper) {
  rows.forEach((row) => {
    const key = dayKey(row.day ?? row.date ?? Object.values(row)[0]);
    if (!key) return;
    const existing = map.get(key) || { day: key };
    map.set(key, { ...existing, ...mapper(row) });
  });
}

/**
 * Sync one store across a date range. Never throws — failures are recorded and
 * reported so one bad store doesn't abort the whole run.
 */
export async function syncStore(store, from, to, opts = {}) {
  await ensureSchema();

  const byDay = new Map();
  const warnings = [];
  let salesOk = false;
  let sessionsOk = false;

  const windows = splitRange(from, to, opts.maxDaysPerQuery || MAX_DAYS_PER_QUERY);

  for (const w of windows) {
    // ── Sales ────────────────────────────────────────────────────
    try {
      const res = await cachedShopifyQL(
        store,
        salesTimeseriesQuery(w.from, w.to, "day"),
        { forceRefresh: true, maxAttempts: 3 }
      );
      mergeIntoDays(byDay, res.rows, (r) => ({
        net_sales: num(r.net_sales),
        gross_sales: num(r.gross_sales),
        total_sales: num(r.total_sales),
        discounts: num(r.discounts),
        orders: num(r.orders),
      }));
      salesOk = true;
    } catch (err) {
      warnings.push(`sales ${w.from}..${w.to}: ${err.message}`);
    }

    // ── Sessions / funnel ────────────────────────────────────────
    // Session metrics don't exist platform-wide before Oct 2022.
    const sFrom = w.from < SESSIONS_DATA_FLOOR ? SESSIONS_DATA_FLOOR : w.from;
    if (sFrom <= w.to) {
      try {
        const res = await cachedShopifyQL(
          store,
          sessionsTimeseriesQuery(sFrom, w.to, "day"),
          { forceRefresh: true, maxAttempts: 3 }
        );
        mergeIntoDays(byDay, res.rows, (r) => ({
          sessions: num(r.sessions),
          cart_adds: num(r.sessions_with_cart_additions),
          reached_checkout: num(r.sessions_that_reached_checkout),
          completed_checkout: num(r.sessions_that_completed_checkout),
        }));
        sessionsOk = true;
      } catch (err) {
        warnings.push(`sessions ${sFrom}..${w.to}: ${err.message}`);
      }
    }
  }

  const rows = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));

  let written = 0;
  try {
    written = await upsertDailyMetrics(store.key, store.domain, rows);
  } catch (err) {
    await recordSyncRun({
      storeKey: store.key, from, to, rowsWritten: 0, ok: false,
      message: "write failed: " + err.message,
    });
    return { store: store.key, ok: false, rowsWritten: 0, error: err.message, warnings };
  }

  const ok = salesOk || sessionsOk;
  await recordSyncRun({
    storeKey: store.key, from, to, rowsWritten: written, ok,
    message: warnings.length ? warnings.slice(0, 3).join(" | ") : null,
  });

  return {
    store: store.key,
    ok,
    rowsWritten: written,
    days: rows.length,
    salesOk,
    sessionsOk,
    warnings,
  };
}

/**
 * Work out what to pull for a store: everything since the last synced day
 * (minus a trailing re-sync window), or an initial backfill.
 */
export async function plannedRange(store, { backfillDays = 400, today } = {}) {
  const end = today || isoDate(Date.now() - 86400000); // yesterday; today is partial
  const last = await lastSyncedDay(store.key);

  if (!last) {
    return { from: addDays(end, -(backfillDays - 1)), to: end, initial: true };
  }

  const start = addDays(last, -RESYNC_TRAILING_DAYS);
  return { from: start > end ? end : start, to: end, initial: false };
}

/**
 * Sync every store. Stores run in parallel (each has its own Shopify budget);
 * queries inside a store are already throttled by the ShopifyQL client.
 */
export async function syncAllStores(stores, opts = {}) {
  await ensureSchema();

  const concurrency = Math.min(
    stores.length,
    parseInt(process.env.SYNC_CONCURRENCY || "4", 10) || 4
  );

  const settled = await mapLimit(stores, concurrency, async (store) => {
    const range = opts.from && opts.to
      ? { from: opts.from, to: opts.to, initial: false }
      : await plannedRange(store, opts);
    const result = await syncStore(store, range.from, range.to, opts);
    return { ...result, range };
  });

  return stores.map((store, i) => {
    const r = settled[i];
    return r && r.ok
      ? r.value
      : { store: store.key, ok: false, rowsWritten: 0, error: r?.error?.message || "unknown error" };
  });
}

// ══════════════════════════════════════════════════════════════════
// DB rows → the array-per-bucket shape the dashboard renders
// ══════════════════════════════════════════════════════════════════
// Buckets by day, week or month so long ranges don't return 700 points.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function bucketKey(day, granularity) {
  const d = new Date(day + "T00:00:00Z");
  if (granularity === "month") {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  if (granularity === "week") {
    // ISO-ish: snap back to Monday
    const dow = (d.getUTCDay() + 6) % 7;
    return isoDate(d.getTime() - dow * 86400000);
  }
  return day;
}

function bucketLabel(key, granularity) {
  const d = new Date(key + "T00:00:00Z");
  if (granularity === "month") return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function aggregateRows(rows, granularity) {
  const buckets = new Map();

  rows.forEach((r) => {
    const key = bucketKey(r.day, granularity);
    const b = buckets.get(key) || {
      key, s: 0, gs: 0, ts: 0, dc: 0, or: 0,
      se: 0, ca: 0, rc: 0, ck: 0,
    };
    b.s += Number(r.net_sales) || 0;
    b.gs += Number(r.gross_sales) || 0;
    b.ts += Number(r.total_sales) || 0;
    b.dc += Number(r.discounts) || 0;
    b.or += Number(r.orders) || 0;
    b.se += Number(r.sessions) || 0;
    b.ca += Number(r.cart_adds) || 0;
    b.rc += Number(r.reached_checkout) || 0;
    b.ck += Number(r.completed_checkout) || 0;
    buckets.set(key, b);
  });

  const ordered = [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : 1));

  return {
    labels: ordered.map((b) => bucketLabel(b.key, granularity)),
    buckets: ordered.map((b) => b.key),
    s: ordered.map((b) => b.s),
    gs: ordered.map((b) => b.gs),
    ts: ordered.map((b) => b.ts),
    dc: ordered.map((b) => b.dc),
    or: ordered.map((b) => b.or),
    se: ordered.map((b) => b.se),
    ca: ordered.map((b) => b.ca),
    rc: ordered.map((b) => b.rc),
    ck: ordered.map((b) => b.ck),
    // AOV per bucket, recomputed rather than averaged
    av: ordered.map((b) => (b.or > 0 ? parseFloat((b.s / b.or).toFixed(2)) : 0)),
    cv: ordered.map((b) => (b.se > 0 ? parseFloat(((b.ck / b.se) * 100).toFixed(2)) : 0)),
  };
}
