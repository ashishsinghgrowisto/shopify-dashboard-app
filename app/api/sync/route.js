// app/api/sync/route.js
// Pulls daily analytics from Shopify into Postgres. Runs on a schedule via
// Vercel Cron (see vercel.json) and can be triggered manually for backfills.
//
//   GET /api/sync                      incremental — since last synced day
//   GET /api/sync?days=400             backfill the last 400 days
//   GET /api/sync?from=2026-01-01&to=2026-06-30
//   GET /api/sync?store=neumapro       one store only
//
// Auth, in order of preference:
//   1. Vercel Cron's `Authorization: Bearer $CRON_SECRET`
//   2. The same Basic credentials that unlock the dashboard, so a backfill can
//      be kicked off from a browser. The alternative — pasting CRON_SECRET into
//      a query string — writes the secret into browser history, referrers and
//      access logs, and these credentials already unlock every number this
//      endpoint would go and fetch.
//   3. ?key=$CRON_SECRET, kept for scripted runs.
// With neither secret configured the route refuses: an open sync endpoint would
// let anyone burn your Shopify rate limit.

import { getAllStores } from "../../../lib/stores";
import { syncAllStores } from "../../../lib/sync";
import { dbAvailable, ensureSchema, recentSyncRuns, coverage, lastSyncedDay } from "../../../lib/db";
import { isoDate } from "../../../lib/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // backfills are slow; give them room

function basicMatches(header, user, password) {
  if (!password || !header.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    const i = decoded.indexOf(":");
    return decoded.slice(0, i) === user && decoded.slice(i + 1) === password;
  } catch {
    return false;
  }
}

function authorized(request, url) {
  const secret = process.env.CRON_SECRET;
  const password = process.env.DASHBOARD_PASSWORD;
  const user = process.env.DASHBOARD_USER || "growisto";
  const header = request.headers.get("authorization") || "";

  if (!secret && !password) {
    return {
      ok: false,
      challenge: false,
      reason: "Neither CRON_SECRET nor DASHBOARD_PASSWORD is set on this deployment",
    };
  }

  if (secret && header === `Bearer ${secret}`) return { ok: true, via: "cron" };
  if (basicMatches(header, user, password)) return { ok: true, via: "dashboard" };
  if (secret && url.searchParams.get("key") === secret) return { ok: true, via: "key" };

  // Challenge only when a dashboard password exists to answer it with —
  // otherwise a browser would prompt for a credential that can never work.
  return { ok: false, challenge: Boolean(password), reason: "Missing or invalid credentials" };
}

async function handle(request) {
  const started = Date.now();
  const url = new URL(request.url);

  const auth = authorized(request, url);
  if (!auth.ok) {
    return Response.json(
      { error: "Unauthorized", hint: auth.reason },
      {
        status: 401,
        headers: auth.challenge
          ? { "WWW-Authenticate": 'Basic realm="Growisto Portfolio Dashboard", charset="UTF-8"' }
          : {},
      }
    );
  }

  if (!dbAvailable()) {
    return Response.json(
      {
        error: "No database configured",
        hint: "Set DATABASE_URL (Vercel → Storage → Neon) so synced metrics have somewhere to live.",
      },
      { status: 500 }
    );
  }

  const all = await getAllStores();

  // ?status=1 reports what's actually in Postgres without syncing anything.
  // Worth having: "the sync said it wrote 800 rows" and "the dashboard can read
  // 800 rows" are different claims, and only the second one matters.
  if (url.searchParams.get("status") === "1") {
    await ensureSchema();
    const today = isoDate(Date.now());
    const perStore = {};
    for (const s of all) {
      perStore[s.key] = {
        domain: s.domain,
        lastSyncedDay: await lastSyncedDay(s.key),
        last400Days: await coverage(s.key, isoDate(Date.now() - 399 * 86400000), today),
      };
    }
    return Response.json({
      database: "connected",
      today,
      stores: perStore,
      recentRuns: await recentSyncRuns(10),
    });
  }
  const wanted = url.searchParams.get("store");
  const stores = wanted ? all.filter((s) => s.key === wanted) : all;

  if (stores.length === 0) {
    return Response.json(
      { error: wanted ? `No store with key "${wanted}"` : "No stores configured" },
      { status: 404 }
    );
  }

  await ensureSchema();

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const days = parseInt(url.searchParams.get("days") || "", 10);

  const opts = {};
  if (from && to) {
    opts.from = from;
    opts.to = to;
  } else if (Number.isFinite(days) && days > 0) {
    const end = isoDate(Date.now() - 86400000);
    opts.from = isoDate(new Date(end + "T00:00:00Z").getTime() - (days - 1) * 86400000);
    opts.to = end;
  }

  const results = await syncAllStores(stores, opts);

  const totals = results.reduce(
    (acc, r) => ({
      stores: acc.stores + 1,
      ok: acc.ok + (r.ok ? 1 : 0),
      rows: acc.rows + (r.rowsWritten || 0),
    }),
    { stores: 0, ok: 0, rows: 0 }
  );

  return Response.json({
    ok: totals.ok === totals.stores,
    totals,
    elapsedMs: Date.now() - started,
    results,
  });
}

export async function GET(request) {
  return handle(request);
}

export async function POST(request) {
  return handle(request);
}
