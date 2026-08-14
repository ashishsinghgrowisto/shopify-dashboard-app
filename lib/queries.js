// lib/queries.js
// Builds the ShopifyQL queries the dashboard needs and reshapes the results into
// the array-per-bucket structure the UI renders.
//
// Field names follow the 2026-07 ShopifyQL schemas:
//   sessions           https://shopify.dev/docs/api/shopifyql/latest/schemas/sessions_and_behavior/sessions
//   sales              https://shopify.dev/docs/api/shopifyql/latest/schemas/sales_revenue/sales
//   campaign_sessions  https://shopify.dev/docs/api/shopifyql/latest/schemas/marketing/campaign_sessions
//   campaign_sales     https://shopify.dev/docs/api/shopifyql/latest/schemas/marketing/campaign_sales
//
// Every dataset is fetched independently and failures are collected as warnings
// rather than thrown, so one unavailable report never blanks the whole dashboard.

import { cachedShopifyQL, mapLimit } from "./shopifyql";

// Sessions-based metrics simply do not exist before this date, platform-wide.
export const SESSIONS_DATA_FLOOR = "2022-10-01";

// ══════════════════════════════════════════════════════════════════
// Date helpers
// ══════════════════════════════════════════════════════════════════

export function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  const ms = new Date(to + "T00:00:00Z") - new Date(from + "T00:00:00Z");
  return Math.round(ms / 86400000) + 1;
}

// Pick a sensible TIMESERIES bucket so a 2-year range doesn't return 730 points
export function pickGranularity(from, to, override) {
  if (override && ["day", "week", "month"].includes(override)) return override;
  const days = daysBetween(from, to);
  if (days <= 45) return "day";
  if (days <= 210) return "week";
  return "month";
}

function labelFor(value, granularity) {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(String(value).slice(0, 10) + "T00:00:00Z");
  if (isNaN(d.getTime())) return String(value);
  const m = MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  const yr = String(d.getUTCFullYear()).slice(2);
  if (granularity === "month") return `${m} ${yr}`;
  if (granularity === "week") return `${m} ${day}`;
  return `${m} ${day}`;
}

// ══════════════════════════════════════════════════════════════════
// Column resolution
// ══════════════════════════════════════════════════════════════════
// ShopifyQL sometimes returns a column named slightly differently from what was
// requested (attribution suffixes, comparison prefixes, display casing). Rather
// than trusting an exact key, resolve loosely.

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickCol(columns, ...candidates) {
  for (const cand of candidates) {
    const exact = columns.find((c) => c === cand);
    if (exact) return exact;
  }
  for (const cand of candidates) {
    const n = norm(cand);
    const loose = columns.find((c) => norm(c) === n);
    if (loose) return loose;
  }
  for (const cand of candidates) {
    const n = norm(cand);
    const partial = columns.find((c) => norm(c).includes(n) || n.includes(norm(c)));
    if (partial) return partial;
  }
  return null;
}

function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const cleaned = String(v).replace(/[$,%\s]/g, "").replace(/,/g, "");
  const parsed = parseFloat(cleaned);
  return isFinite(parsed) ? parsed : 0;
}

// Conversion-style metrics come back as either 0.0234 or 2.34 depending on the
// metric. Normalise to a percentage number (2.34).
function asPercent(v) {
  const n = num(v);
  if (n === 0) return 0;
  return n <= 1 ? parseFloat((n * 100).toFixed(2)) : parseFloat(n.toFixed(2));
}

function findDateCol(columns, granularity) {
  return (
    pickCol(columns, granularity, "day", "week", "month", "date", "hour") ||
    columns[0] ||
    null
  );
}

// ══════════════════════════════════════════════════════════════════
// Query builders
// ══════════════════════════════════════════════════════════════════

export function salesTimeseriesQuery(from, to, granularity) {
  return [
    "FROM sales",
    "SHOW net_sales, gross_sales, total_sales, orders, average_order_value, discounts",
    `TIMESERIES ${granularity}`,
    `SINCE ${from} UNTIL ${to}`,
    `ORDER BY ${granularity} ASC`,
  ].join(" ");
}

export function sessionsTimeseriesQuery(from, to, granularity) {
  return [
    "FROM sessions",
    "SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout, conversion_rate",
    "WHERE human_or_bot_session = 'human'",
    `TIMESERIES ${granularity}`,
    `SINCE ${from} UNTIL ${to}`,
    `ORDER BY ${granularity} ASC`,
  ].join(" ");
}

export function referrersQuery(from, to, limit = 15) {
  return [
    "FROM sessions",
    "SHOW sessions, sessions_that_completed_checkout, conversion_rate",
    "WHERE human_or_bot_session = 'human'",
    "GROUP BY referrer_source, referrer_name",
    `SINCE ${from} UNTIL ${to}`,
    "ORDER BY sessions DESC",
    `LIMIT ${limit}`,
  ].join(" ");
}

export function campaignSessionsQuery(from, to, limit = 60) {
  return [
    "FROM campaign_sessions",
    "SHOW campaign_sessions, campaign_sessions_that_completed_checkout, campaign_conversion_rate",
    "GROUP BY utm_campaign, referring_channel",
    `SINCE ${from} UNTIL ${to}`,
    "ORDER BY campaign_sessions DESC",
    `LIMIT ${limit}`,
  ].join(" ");
}

export function campaignSalesQuery(from, to, limit = 60) {
  return [
    "FROM campaign_sales",
    "SHOW campaign_last_non_direct_click_order_count, campaign_last_non_direct_click_total_sales, campaign_last_non_direct_click_total_average_order_value",
    "GROUP BY utm_campaign, referring_channel",
    `SINCE ${from} UNTIL ${to}`,
    "ORDER BY campaign_last_non_direct_click_total_sales DESC",
    `LIMIT ${limit}`,
  ].join(" ");
}

// Fallback used if the campaign_* schemas aren't reachable on a store: derive
// campaign performance from the sessions + sales schemas' utm dimensions.
export function utmFallbackSessionsQuery(from, to, limit = 60) {
  return [
    "FROM sessions",
    "SHOW sessions, sessions_that_completed_checkout, conversion_rate",
    "WHERE human_or_bot_session = 'human'",
    "GROUP BY utm_campaign, referring_channel",
    `SINCE ${from} UNTIL ${to}`,
    "ORDER BY sessions DESC",
    `LIMIT ${limit}`,
  ].join(" ");
}

export function utmFallbackSalesQuery(from, to, limit = 60) {
  return [
    "FROM sales",
    "SHOW total_sales, orders, average_order_value",
    "GROUP BY utm_campaign",
    `SINCE ${from} UNTIL ${to}`,
    "ORDER BY total_sales DESC",
    `LIMIT ${limit}`,
  ].join(" ");
}

// ══════════════════════════════════════════════════════════════════
// Reshapers
// ══════════════════════════════════════════════════════════════════

function reshapeSales(result, granularity) {
  const { columns, rows } = result;
  const dateCol = findDateCol(columns, granularity);
  const cNet = pickCol(columns, "net_sales");
  const cGross = pickCol(columns, "gross_sales");
  const cTotal = pickCol(columns, "total_sales");
  const cOrders = pickCol(columns, "orders");
  const cAov = pickCol(columns, "average_order_value");
  const cDisc = pickCol(columns, "discounts");

  const out = { buckets: [], labels: [], s: [], gs: [], ts: [], or: [], av: [], dc: [] };
  rows.forEach((row) => {
    const bucket = dateCol ? row[dateCol] : null;
    out.buckets.push(bucket);
    out.labels.push(labelFor(bucket, granularity));
    out.s.push(num(cNet ? row[cNet] : cTotal ? row[cTotal] : 0));
    out.gs.push(num(cGross ? row[cGross] : 0));
    out.ts.push(num(cTotal ? row[cTotal] : 0));
    out.or.push(num(cOrders ? row[cOrders] : 0));
    out.av.push(num(cAov ? row[cAov] : 0));
    out.dc.push(num(cDisc ? row[cDisc] : 0));
  });
  return out;
}

function reshapeSessions(result, granularity) {
  const { columns, rows } = result;
  const dateCol = findDateCol(columns, granularity);
  const cSe = pickCol(columns, "sessions");
  const cCa = pickCol(columns, "sessions_with_cart_additions");
  const cRc = pickCol(columns, "sessions_that_reached_checkout");
  const cCk = pickCol(columns, "sessions_that_completed_checkout");
  const cCv = pickCol(columns, "conversion_rate");

  const out = { buckets: [], labels: [], se: [], ca: [], rc: [], ck: [], cv: [] };
  rows.forEach((row) => {
    const bucket = dateCol ? row[dateCol] : null;
    out.buckets.push(bucket);
    out.labels.push(labelFor(bucket, granularity));
    out.se.push(num(cSe ? row[cSe] : 0));
    out.ca.push(num(cCa ? row[cCa] : 0));
    out.rc.push(num(cRc ? row[cRc] : 0));
    out.ck.push(num(cCk ? row[cCk] : 0));
    out.cv.push(asPercent(cCv ? row[cCv] : 0));
  });
  return out;
}

function reshapeReferrers(result) {
  const { columns, rows } = result;
  const cSrc = pickCol(columns, "referrer_source");
  const cName = pickCol(columns, "referrer_name");
  const cSe = pickCol(columns, "sessions");
  const cCk = pickCol(columns, "sessions_that_completed_checkout");
  const cCv = pickCol(columns, "conversion_rate");

  const merged = new Map();
  rows.forEach((row) => {
    const src = cSrc ? row[cSrc] : null;
    const name = cName ? row[cName] : null;
    const label = String(name || src || "Direct / none").trim() || "Direct / none";
    const sessions = num(cSe ? row[cSe] : 0);
    const conversions = num(cCk ? row[cCk] : 0);
    const prev = merged.get(label) || { n: label, s: 0, ck: 0, r: 0, src: src || "" };
    prev.s += sessions;
    prev.ck += conversions;
    // keep the reported rate when we can't recompute
    if (!cCk && cCv) prev.r = asPercent(row[cCv]);
    merged.set(label, prev);
  });

  return [...merged.values()]
    .map((r) => ({
      n: r.n,
      s: r.s,
      r: r.s > 0 && r.ck > 0 ? parseFloat(((r.ck / r.s) * 100).toFixed(2)) : r.r,
      src: r.src,
    }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 12);
}

const CHANNEL_COLORS = {
  email: "#818CF8",
  social: "#EC4899",
  search: "#F59E0B",
  direct: "#34D399",
  referral: "#06B6D4",
  paid: "#3B82F6",
  sms: "#A78BFA",
  affiliate: "#F472B6",
  agentic: "#22D3EE",
  other: "#6B7280",
};

function channelColor(channel) {
  const c = String(channel || "").toLowerCase();
  for (const [k, v] of Object.entries(CHANNEL_COLORS)) {
    if (c.includes(k)) return v;
  }
  return CHANNEL_COLORS.other;
}

function reshapeCampaigns(sessionsRes, salesRes) {
  const byKey = new Map();

  function keyOf(campaign, channel) {
    return `${String(campaign || "(none)").trim()}||${String(channel || "").trim()}`;
  }

  if (sessionsRes && !sessionsRes.failed) {
    const { columns, rows } = sessionsRes;
    const cCamp = pickCol(columns, "utm_campaign", "campaign_name", "utm_campaign_name");
    const cChan = pickCol(columns, "referring_channel", "utm_medium", "traffic_type");
    const cSe = pickCol(columns, "campaign_sessions", "sessions");
    const cCk = pickCol(columns, "campaign_sessions_that_completed_checkout", "sessions_that_completed_checkout");
    const cCv = pickCol(columns, "campaign_conversion_rate", "conversion_rate");

    rows.forEach((row) => {
      const camp = cCamp ? row[cCamp] : null;
      const chan = cChan ? row[cChan] : null;
      const k = keyOf(camp, chan);
      const entry = byKey.get(k) || {
        nm: String(camp || "(none)").trim() || "(none)",
        ch: String(chan || "Unattributed").trim() || "Unattributed",
        se: 0, sa: 0, or: 0, cv: 0, av: 0,
      };
      entry.se += num(cSe ? row[cSe] : 0);
      const conv = num(cCk ? row[cCk] : 0);
      if (conv > 0) entry._ck = (entry._ck || 0) + conv;
      else if (cCv) entry.cv = asPercent(row[cCv]);
      byKey.set(k, entry);
    });
  }

  if (salesRes && !salesRes.failed) {
    const { columns, rows } = salesRes;
    const cCamp = pickCol(columns, "utm_campaign", "campaign_name", "utm_campaign_name");
    const cChan = pickCol(columns, "referring_channel", "utm_medium", "traffic_type");
    const cSales = pickCol(
      columns,
      "campaign_last_non_direct_click_total_sales",
      "total_sales__last_non_direct_click",
      "total_sales",
      "net_sales"
    );
    const cOrders = pickCol(
      columns,
      "campaign_last_non_direct_click_order_count",
      "orders__last_non_direct_click",
      "orders",
      "order_count"
    );
    const cAov = pickCol(
      columns,
      "campaign_last_non_direct_click_total_average_order_value",
      "average_order_value"
    );

    rows.forEach((row) => {
      const camp = cCamp ? row[cCamp] : null;
      const chan = cChan ? row[cChan] : null;
      let k = keyOf(camp, chan);
      if (!byKey.has(k) && !cChan) {
        // Sales fallback query has no channel dimension — match on campaign alone
        const existing = [...byKey.keys()].find(
          (kk) => kk.split("||")[0] === String(camp || "(none)").trim()
        );
        if (existing) k = existing;
      }
      const entry = byKey.get(k) || {
        nm: String(camp || "(none)").trim() || "(none)",
        ch: String(chan || "Unattributed").trim() || "Unattributed",
        se: 0, sa: 0, or: 0, cv: 0, av: 0,
      };
      entry.sa += num(cSales ? row[cSales] : 0);
      entry.or += num(cOrders ? row[cOrders] : 0);
      if (cAov) entry.av = num(row[cAov]);
      byKey.set(k, entry);
    });
  }

  const campaigns = [...byKey.values()].map((c) => {
    if (c._ck && c.se > 0) c.cv = parseFloat(((c._ck / c.se) * 100).toFixed(2));
    else if (!c.cv && c.se > 0 && c.or > 0) c.cv = parseFloat(((c.or / c.se) * 100).toFixed(2));
    if (!c.av && c.or > 0) c.av = parseFloat((c.sa / c.or).toFixed(2));
    delete c._ck;
    c.cl = channelColor(c.ch);
    return c;
  });

  campaigns.sort((a, b) => b.sa - a.sa || b.se - a.se);

  const channelMap = new Map();
  campaigns.forEach((c) => {
    const key = c.ch || "Unattributed";
    const ch = channelMap.get(key) || { ch: key, se: 0, sa: 0, or: 0, campaigns: 0, cl: c.cl };
    ch.se += c.se;
    ch.sa += c.sa;
    ch.or += c.or;
    ch.campaigns += 1;
    channelMap.set(key, ch);
  });

  const channels = [...channelMap.values()]
    .map((ch) => {
      ch.cv = ch.se > 0 ? parseFloat(((ch.or / ch.se) * 100).toFixed(2)) : 0;
      ch.av = ch.or > 0 ? parseFloat((ch.sa / ch.or).toFixed(2)) : 0;
      return ch;
    })
    .sort((a, b) => b.sa - a.sa);

  return { campaigns: campaigns.slice(0, 60), channels };
}

// ══════════════════════════════════════════════════════════════════
// Per-store orchestration
// ══════════════════════════════════════════════════════════════════

async function tryQuery(store, query, opts, warnings, label) {
  try {
    return await cachedShopifyQL(store, query, opts);
  } catch (err) {
    warnings.push({
      store: store.key,
      dataset: label,
      code: err.code || "ERROR",
      message: err.message,
    });
    return { failed: true, columns: [], rows: [] };
  }
}

/**
 * Fetch everything one store needs for the given primary + comparison ranges.
 * Never throws: partial failures come back in `warnings`.
 */
export async function fetchStoreData(store, range, compare, opts = {}) {
  const warnings = [];
  const granularity = pickGranularity(range.from, range.to, opts.granularity);

  // Sessions data doesn't exist before Oct 2022 — clamp instead of erroring.
  const sFrom = range.from < SESSIONS_DATA_FLOOR ? SESSIONS_DATA_FLOOR : range.from;
  if (sFrom !== range.from) {
    warnings.push({
      store: store.key,
      dataset: "sessions",
      code: "DATA_FLOOR",
      message: `Session metrics only exist from ${SESSIONS_DATA_FLOOR}; traffic and funnel data before that is unavailable platform-wide.`,
    });
  }

  const jobs = [
    { label: "sales", q: salesTimeseriesQuery(range.from, range.to, granularity) },
    { label: "sessions", q: sessionsTimeseriesQuery(sFrom, range.to, granularity) },
    { label: "referrers", q: referrersQuery(sFrom, range.to) },
    { label: "campaignSessions", q: campaignSessionsQuery(range.from, range.to) },
    { label: "campaignSales", q: campaignSalesQuery(range.from, range.to) },
  ];

  if (compare && compare.from && compare.to) {
    const cFrom = compare.from < SESSIONS_DATA_FLOOR ? SESSIONS_DATA_FLOOR : compare.from;
    jobs.push({ label: "salesCompare", q: salesTimeseriesQuery(compare.from, compare.to, granularity) });
    jobs.push({ label: "sessionsCompare", q: sessionsTimeseriesQuery(cFrom, compare.to, granularity) });
  }

  const settled = await mapLimit(jobs, opts.concurrency || 3, (job) =>
    tryQuery(store, job.q, opts, warnings, job.label)
  );

  const byLabel = {};
  jobs.forEach((job, i) => {
    const r = settled[i];
    byLabel[job.label] = r && r.ok ? r.value : { failed: true, columns: [], rows: [] };
  });

  // Campaign fallback: if the marketing schemas aren't available, derive from
  // sessions/sales utm dimensions instead.
  if (byLabel.campaignSessions.failed && byLabel.campaignSales.failed) {
    const fb = await mapLimit(
      [
        { label: "campaignSessions", q: utmFallbackSessionsQuery(sFrom, range.to) },
        { label: "campaignSales", q: utmFallbackSalesQuery(range.from, range.to) },
      ],
      2,
      (job) => tryQuery(store, job.q, opts, warnings, job.label + "Fallback")
    );
    if (fb[0]?.ok) byLabel.campaignSessions = fb[0].value;
    if (fb[1]?.ok) byLabel.campaignSales = fb[1].value;
  }

  const sales = reshapeSales(byLabel.sales, granularity);
  const sessions = reshapeSessions(byLabel.sessions, granularity);
  const salesCmp = byLabel.salesCompare ? reshapeSales(byLabel.salesCompare, granularity) : null;
  const sessionsCmp = byLabel.sessionsCompare
    ? reshapeSessions(byLabel.sessionsCompare, granularity)
    : null;

  // Bucket labels: prefer whichever series has more points
  const labels = sales.labels.length >= sessions.labels.length ? sales.labels : sessions.labels;
  const buckets = sales.buckets.length >= sessions.buckets.length ? sales.buckets : sessions.buckets;
  const n = Math.max(sales.labels.length, sessions.labels.length);
  const pad = (arr) => Array.from({ length: n }, (_, i) => (arr && arr[i] != null ? arr[i] : 0));

  const se = pad(sessions.se);
  const ca = pad(sessions.ca);
  const rc = pad(sessions.rc);
  const ck = pad(sessions.ck);
  const sep = pad(sessionsCmp?.se);
  const cap = pad(sessionsCmp?.ca);
  const rcp = pad(sessionsCmp?.rc);
  const ckp = pad(sessionsCmp?.ck);

  const rate = (a, b) =>
    a.map((v, i) => (b[i] > 0 ? parseFloat(((v / b[i]) * 100).toFixed(2)) : 0));

  const referrers = byLabel.referrers.failed ? [] : reshapeReferrers(byLabel.referrers);
  const campaignData = reshapeCampaigns(byLabel.campaignSessions, byLabel.campaignSales);

  return {
    warnings,
    granularity,
    data: {
      labels,
      buckets,
      // sales
      s: pad(sales.s),
      sp: pad(salesCmp?.s),
      gs: pad(sales.gs),
      ts: pad(sales.ts),
      dc: pad(sales.dc),
      // orders / AOV
      or: pad(sales.or),
      orp: pad(salesCmp?.or),
      av: pad(sales.av),
      ap: pad(salesCmp?.av),
      // funnel
      se, ca, rc, ck,
      sep, cap, rcp, ckp,
      cv: pad(sessions.cv),
      cvp: pad(sessionsCmp?.cv),
      // derived funnel rates
      acr: rate(ca, se),
      ccr: rate(rc, se),
      c2c: rate(rc, ca),
      acrp: rate(cap, sep),
      ccrp: rate(rcp, sep),
      c2cp: rate(rcp, cap),
      // breakdowns
      rf: referrers,
      ut: campaignData.campaigns,
      uc: campaignData.channels,
    },
  };
}

// Diagnostics: probe a store to see exactly which datasets/columns are reachable.
export async function probeStore(store) {
  const to = isoDate(Date.now() - 86400000);
  const from = isoDate(Date.now() - 8 * 86400000);

  const probes = [
    { name: "sales (timeseries)", q: salesTimeseriesQuery(from, to, "day") },
    { name: "sessions (funnel)", q: sessionsTimeseriesQuery(from, to, "day") },
    { name: "referrers", q: referrersQuery(from, to, 5) },
    { name: "campaign_sessions", q: campaignSessionsQuery(from, to, 5) },
    { name: "campaign_sales", q: campaignSalesQuery(from, to, 5) },
    { name: "utm fallback (sessions)", q: utmFallbackSessionsQuery(from, to, 5) },
    { name: "utm fallback (sales)", q: utmFallbackSalesQuery(from, to, 5) },
  ];

  const results = await mapLimit(probes, 2, async (p) => {
    const started = Date.now();
    try {
      const r = await cachedShopifyQL(store, p.q, { forceRefresh: true, maxAttempts: 2 });
      return {
        probe: p.name,
        ok: true,
        rows: r.rows.length,
        columns: r.columns,
        ms: Date.now() - started,
        query: p.q,
      };
    } catch (err) {
      return {
        probe: p.name,
        ok: false,
        code: err.code || "ERROR",
        error: err.message,
        ms: Date.now() - started,
        query: p.q,
      };
    }
  });

  return {
    store: { key: store.key, label: store.label, domain: store.domain },
    range: { from, to },
    probes: results.map((r) => (r.ok ? r.value : { probe: "unknown", ok: false, error: String(r.error) })),
  };
}
