// app/api/filters/route.js
// Values for the dashboard's filter pickers, gathered across every store.
//
// GET /api/filters?from=2026-07-01&to=2026-09-30   (defaults: last 90 days)
//
// Two ShopifyQL queries per store — one on sessions grouped by all four session
// dimensions, one on sales grouped by channel — cached like every other query.
// Values are ranked by volume across the portfolio so the common ones come first.

import { getAllStores } from "../../../lib/stores";
import { isoDate, filterOptionsSessionsQuery, filterOptionsSalesQuery, SESSIONS_DATA_FLOOR } from "../../../lib/queries";
import { cachedShopifyQL, mapLimit } from "../../../lib/shopifyql";
import { FILTER_DEFS } from "../../../lib/filters";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SESSION_DIMS = { traffic: "traffic_type", source: "referrer_source", medium: "referring_medium", landing: "landing_page_type" };

function num(v) {
  const n = parseFloat(String(v ?? "").replace(/[$,%\s]/g, ""));
  return isFinite(n) ? n : 0;
}

function bump(map, value, weight) {
  const v = String(value ?? "").trim();
  if (!v) return;
  map.set(v, (map.get(v) || 0) + weight);
}

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const yesterday = isoDate(Date.now() - 86400000);
  let to = p.get("to") || yesterday;
  let from = p.get("from") || isoDate(new Date(to + "T00:00:00Z").getTime() - 89 * 86400000);
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return Response.json({ error: "Invalid from/to" }, { status: 400 });
  }
  const sFrom = from < SESSIONS_DATA_FLOOR ? SESSIONS_DATA_FLOOR : from;

  const stores = await getAllStores();
  const maps = { channel: new Map(), traffic: new Map(), source: new Map(), medium: new Map(), landing: new Map() };
  const errors = [];

  await mapLimit(stores, 6, async (store) => {
    const [sess, sales] = await Promise.allSettled([
      cachedShopifyQL(store, filterOptionsSessionsQuery(sFrom, to), { maxAttempts: 2 }),
      cachedShopifyQL(store, filterOptionsSalesQuery(from, to), { maxAttempts: 2 }),
    ]);

    if (sess.status === "fulfilled") {
      sess.value.rows.forEach((row) => {
        const w = num(row.sessions);
        for (const [key, dim] of Object.entries(SESSION_DIMS)) bump(maps[key], row[dim], w);
      });
    } else {
      errors.push({ store: store.key, dataset: "sessions", message: sess.reason?.message });
    }

    if (sales.status === "fulfilled") {
      sales.value.rows.forEach((row) => bump(maps.channel, row.sales_channel, num(row.orders) || 1));
    } else {
      errors.push({ store: store.key, dataset: "sales", message: sales.reason?.message });
    }
  });

  const options = {};
  for (const [key, map] of Object.entries(maps)) {
    options[key] = {
      label: FILTER_DEFS[key].label,
      appliesTo: { sessions: Boolean(FILTER_DEFS[key].sessions), sales: Boolean(FILTER_DEFS[key].sales) },
      values: [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([value, weight]) => ({ value, weight })),
    };
  }

  return Response.json(
    { range: { from, to }, options, errors },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
