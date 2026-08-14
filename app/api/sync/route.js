// app/api/sync/route.js
// Pulls daily analytics from Shopify into Postgres. Runs on a schedule via
// Vercel Cron (see vercel.json) and can be triggered manually for backfills.
//
//   GET /api/sync                      incremental — since last synced day
//   GET /api/sync?days=400             backfill the last 400 days
//   GET /api/sync?from=2026-01-01&to=2026-06-30
//   GET /api/sync?store=neumapro       one store only
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Manual runs can
// pass ?key=$CRON_SECRET. Without CRON_SECRET set the route refuses to run —
// an open sync endpoint would let anyone burn your Shopify rate limit.

import { getAllStores } from "../../../lib/stores";
import { syncAllStores } from "../../../lib/sync";
import { dbAvailable, ensureSchema, recentSyncRuns } from "../../../lib/db";
import { isoDate } from "../../../lib/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // backfills are slow; give them room

function authorized(request, url) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, reason: "CRON_SECRET is not set on this deployment" };

  const header = request.headers.get("authorization") || "";
  if (header === `Bearer ${secret}`) return { ok: true };
  if (url.searchParams.get("key") === secret) return { ok: true };

  return { ok: false, reason: "Missing or invalid credentials" };
}

async function handle(request) {
  const started = Date.now();
  const url = new URL(request.url);

  const auth = authorized(request, url);
  if (!auth.ok) {
    return Response.json({ error: "Unauthorized", hint: auth.reason }, { status: 401 });
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
