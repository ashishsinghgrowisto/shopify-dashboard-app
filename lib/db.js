// lib/db.js
// Postgres access for synced analytics.
//
// Uses Neon's serverless driver, which talks over HTTP rather than a TCP socket.
// That matters on Vercel: serverless functions are short-lived and a TCP pool
// would either leak connections or pay a handshake on every invocation.
//
// The whole database layer is optional. If no connection string is configured,
// dbAvailable() returns false and the dashboard falls back to querying Shopify
// live, exactly as it did before.

import { neon } from "@neondatabase/serverless";

let client = null;
let schemaReady = false;

function connectionString() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    ""
  );
}

export function dbAvailable() {
  return Boolean(connectionString());
}

export function getSql() {
  if (!dbAvailable()) return null;
  if (!client) client = neon(connectionString());
  return client;
}

// ══════════════════════════════════════════════════════════════════
// Schema
// ══════════════════════════════════════════════════════════════════
// One row per store per day. Everything the Overview / Net Sales /
// Conversion / AOV / Funnel tabs need is here, so those tabs never touch
// the Shopify API once a day has been synced.
//
// Sales and sessions are stored as separate nullable groups because they come
// from two different ShopifyQL schemas and one can succeed while the other
// fails. `synced_at` lets the sync job re-pull recent days without re-pulling
// history.

export async function ensureSchema() {
  const sql = getSql();
  if (!sql) return false;
  if (schemaReady) return true;

  await sql`
    CREATE TABLE IF NOT EXISTS daily_metrics (
      store_key            text        NOT NULL,
      shop_domain          text        NOT NULL,
      day                  date        NOT NULL,
      net_sales            numeric(14,2),
      gross_sales          numeric(14,2),
      total_sales          numeric(14,2),
      discounts            numeric(14,2),
      orders               integer,
      sessions             integer,
      cart_adds            integer,
      reached_checkout     integer,
      completed_checkout   integer,
      synced_at            timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (store_key, day)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS daily_metrics_day_idx ON daily_metrics (day)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sync_runs (
      id          bigserial   PRIMARY KEY,
      store_key   text        NOT NULL,
      range_from  date        NOT NULL,
      range_to    date        NOT NULL,
      rows_written integer    NOT NULL DEFAULT 0,
      ok          boolean     NOT NULL DEFAULT true,
      message     text,
      ran_at      timestamptz NOT NULL DEFAULT now()
    )
  `;

  schemaReady = true;
  return true;
}

// ══════════════════════════════════════════════════════════════════
// Reads
// ══════════════════════════════════════════════════════════════════

// Daily rows for one store across an inclusive date range.
export async function readDailyMetrics(storeKey, from, to) {
  const sql = getSql();
  if (!sql) return [];
  // Reads can land before any sync has created the tables — on a fresh database,
  // or on a new deployment where the read path runs first.
  await ensureSchema();
  return await sql`
    SELECT day::text AS day,
           net_sales, gross_sales, total_sales, discounts,
           orders, sessions, cart_adds, reached_checkout, completed_checkout
    FROM daily_metrics
    WHERE store_key = ${storeKey} AND day >= ${from} AND day <= ${to}
    ORDER BY day ASC
  `;
}

// How much of a range is actually present — used to decide whether the DB can
// serve a request or whether we need to fall back to live Shopify queries.
export async function coverage(storeKey, from, to) {
  const sql = getSql();
  if (!sql) return { days: 0, minDay: null, maxDay: null };
  await ensureSchema();
  const rows = await sql`
    SELECT count(*)::int AS days,
           min(day)::text AS min_day,
           max(day)::text AS max_day
    FROM daily_metrics
    WHERE store_key = ${storeKey} AND day >= ${from} AND day <= ${to}
  `;
  const r = rows[0] || {};
  return { days: r.days || 0, minDay: r.min_day || null, maxDay: r.max_day || null };
}

export async function lastSyncedDay(storeKey) {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql`
    SELECT max(day)::text AS d FROM daily_metrics WHERE store_key = ${storeKey}
  `;
  return rows[0]?.d || null;
}

export async function recentSyncRuns(limit = 20) {
  const sql = getSql();
  if (!sql) return [];
  return await sql`
    SELECT store_key, range_from::text, range_to::text, rows_written, ok, message, ran_at
    FROM sync_runs ORDER BY ran_at DESC LIMIT ${limit}
  `;
}

// ══════════════════════════════════════════════════════════════════
// Writes
// ══════════════════════════════════════════════════════════════════

// Upsert so a re-sync of the same days corrects earlier values rather than
// duplicating them. Recent days genuinely do change — late orders, refunds,
// and Shopify's own attribution settling — so re-syncing a trailing window is
// expected, not wasteful.
export async function upsertDailyMetrics(storeKey, shopDomain, rows) {
  const sql = getSql();
  if (!sql || rows.length === 0) return 0;

  let written = 0;
  // Chunked to keep each statement well inside parameter limits.
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    for (const r of chunk) {
      await sql`
        INSERT INTO daily_metrics (
          store_key, shop_domain, day,
          net_sales, gross_sales, total_sales, discounts,
          orders, sessions, cart_adds, reached_checkout, completed_checkout, synced_at
        ) VALUES (
          ${storeKey}, ${shopDomain}, ${r.day},
          ${r.net_sales ?? null}, ${r.gross_sales ?? null}, ${r.total_sales ?? null}, ${r.discounts ?? null},
          ${r.orders ?? null}, ${r.sessions ?? null}, ${r.cart_adds ?? null},
          ${r.reached_checkout ?? null}, ${r.completed_checkout ?? null}, now()
        )
        ON CONFLICT (store_key, day) DO UPDATE SET
          shop_domain        = EXCLUDED.shop_domain,
          -- COALESCE keeps a previously-synced value when this run couldn't
          -- fetch that half (e.g. sessions failed but sales succeeded).
          net_sales          = COALESCE(EXCLUDED.net_sales,          daily_metrics.net_sales),
          gross_sales        = COALESCE(EXCLUDED.gross_sales,        daily_metrics.gross_sales),
          total_sales        = COALESCE(EXCLUDED.total_sales,        daily_metrics.total_sales),
          discounts          = COALESCE(EXCLUDED.discounts,          daily_metrics.discounts),
          orders             = COALESCE(EXCLUDED.orders,             daily_metrics.orders),
          sessions           = COALESCE(EXCLUDED.sessions,           daily_metrics.sessions),
          cart_adds          = COALESCE(EXCLUDED.cart_adds,          daily_metrics.cart_adds),
          reached_checkout   = COALESCE(EXCLUDED.reached_checkout,   daily_metrics.reached_checkout),
          completed_checkout = COALESCE(EXCLUDED.completed_checkout, daily_metrics.completed_checkout),
          synced_at          = now()
      `;
      written++;
    }
  }
  return written;
}

export async function recordSyncRun({ storeKey, from, to, rowsWritten, ok, message }) {
  const sql = getSql();
  if (!sql) return;
  await sql`
    INSERT INTO sync_runs (store_key, range_from, range_to, rows_written, ok, message)
    VALUES (${storeKey}, ${from}, ${to}, ${rowsWritten || 0}, ${ok !== false}, ${message || null})
  `;
}
