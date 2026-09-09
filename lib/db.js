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
    if (!client) client = neon(connectionString(), { fetchOptions: { cache: "no-store" } });
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

// Both range reads use sql.query() with numbered placeholders and explicit
// ::date casts rather than a tagged template. A tagged-template version of the
// coverage query returned zero rows for a window that demonstrably contained
// thirty — while the same predicates with literals, or with the key and the
// dates bound separately, all matched. Being explicit about placeholder order
// and parameter type removes the ambiguity that made that possible.
const RANGE_WHERE = "WHERE store_key = $1 AND day >= $2::date AND day <= $3::date";

// Daily rows for one store across an inclusive date range.
export async function readDailyMetrics(storeKey, from, to) {
  const sql = getSql();
  if (!sql) return [];
  // Reads can land before any sync has created the tables — on a fresh database,
  // or on a new deployment where the read path runs first.
  await ensureSchema();
  return await sql.query(
    `SELECT day::text AS day,
            net_sales, gross_sales, total_sales, discounts,
            orders, sessions, cart_adds, reached_checkout, completed_checkout
     FROM daily_metrics
     ${RANGE_WHERE}
     ORDER BY day ASC`,
    [storeKey, from, to]
  );
}

// How much of a range is actually present — used to decide whether the DB can
// serve a request or whether we need to fall back to live Shopify queries.
export async function coverage(storeKey, from, to) {
  const sql = getSql();
  if (!sql) return { days: 0, minDay: null, maxDay: null };
  await ensureSchema();
  const rows = await sql.query(
    `SELECT count(*)::int AS days,
            min(day)::text AS min_day,
            max(day)::text AS max_day
     FROM daily_metrics
     ${RANGE_WHERE}`,
    [storeKey, from, to]
  );
  const r = (Array.isArray(rows) ? rows[0] : rows?.rows?.[0]) || {};
  return {
    days: Number(r.days) || 0,
    minDay: r.min_day || null,
    maxDay: r.max_day || null,
  };
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
// One column list, used to build both the INSERT target and the placeholders.
const UPSERT_COLS = [
  "net_sales", "gross_sales", "total_sales", "discounts",
  "orders", "sessions", "cart_adds", "reached_checkout", "completed_checkout",
];

export async function upsertDailyMetrics(storeKey, shopDomain, rows) {
  const sql = getSql();
  if (!sql || rows.length === 0) return 0;

  // A 400-day backfill is ~400 rows per store. Writing them one statement at a
  // time meant 400 HTTP round trips to Neon, which alone can outlast the
  // function's time limit. Batching into multi-row INSERTs turns that into a
  // handful of round trips.
  //
  // 12 params per row x 200 rows = 2,400 — comfortably inside Postgres's
  // 65,535 bound-parameter ceiling.
  const CHUNK = 200;
  let written = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((r) => {
      const base = params.length;
      params.push(
        storeKey, shopDomain, r.day,
        r.net_sales ?? null, r.gross_sales ?? null, r.total_sales ?? null, r.discounts ?? null,
        r.orders ?? null, r.sessions ?? null, r.cart_adds ?? null,
        r.reached_checkout ?? null, r.completed_checkout ?? null
      );
      // No casts needed: inside INSERT ... VALUES, Postgres resolves untyped
      // parameters against the target column types, nulls included.
      const slots = Array.from({ length: 12 }, (_, k) => `$${base + k + 1}`);
      return `(${slots.join(", ")}, now())`;
    });

    const text = `
      INSERT INTO daily_metrics (
        store_key, shop_domain, day,
        ${UPSERT_COLS.join(", ")}, synced_at
      ) VALUES ${tuples.join(", ")}
      ON CONFLICT (store_key, day) DO UPDATE SET
        shop_domain = EXCLUDED.shop_domain,
        -- COALESCE keeps a previously-synced value when this run couldn't
        -- fetch that half (e.g. sessions failed but sales succeeded).
        ${UPSERT_COLS.map((c) => `${c} = COALESCE(EXCLUDED.${c}, daily_metrics.${c})`).join(",\n        ")},
        synced_at = now()
    `;

    await sql.query(text, params);
    written += chunk.length;
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
