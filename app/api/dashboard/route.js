// app/api/dashboard/route.js
// Fans out live ShopifyQL queries across every connected store for the requested
// date range + comparison range, then returns per-store and consolidated data.
//
// GET /api/dashboard?from=2026-07-01&to=2026-07-31&cfrom=2026-06-01&cto=2026-06-30
// Optional: &granularity=day|week|month  &stores=cp,nb  &refresh=1

import { getAllStores } from "../../../lib/stores";
import { isoDate, pickGranularity } from "../../../lib/queries";
import { fetchStoreDataServed } from "../../../lib/serve";
import { consolidate } from "../../../lib/consolidate";
import { mapLimit, cacheStats } from "../../../lib/shopifyql";
import { isMockEnabled, buildMockPayload } from "../../../lib/mock";
import { dbAvailable } from "../../../lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow multi-store fan-out

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badRequest(message, extra = {}) {
  return Response.json({ error: message, ...extra }, { status: 400 });
}

function defaultRanges() {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const to = isoDate(yesterday);
  const from = isoDate(new Date(yesterday.getTime() - 29 * 86400000));
  // Comparison: the 30 days immediately before the primary window
  const cto = isoDate(new Date(new Date(from + "T00:00:00Z").getTime() - 86400000));
  const cfrom = isoDate(new Date(new Date(cto + "T00:00:00Z").getTime() - 29 * 86400000));
  return { from, to, cfrom, cto };
}

export async function GET(request) {
  const started = Date.now();
  const url = new URL(request.url);
  const p = url.searchParams;

  const mock = isMockEnabled(p);
  const stores = mock ? [] : await getAllStores();
  if (stores.length === 0 && !mock) {
    return Response.json(
      {
        error: "No stores configured",
        hint:
          "Add at least one store via the SHOPIFY_STORES JSON env var, or STORE_1_DOMAIN / STORE_1_TOKEN / STORE_1_LABEL. See README.",
        stores: [],
      },
      { status: 500 }
    );
  }

  const defaults = defaultRanges();
  const from = p.get("from") || defaults.from;
  const to = p.get("to") || defaults.to;
  const cfrom = p.get("cfrom") || defaults.cfrom;
  const cto = p.get("cto") || defaults.cto;

  for (const [name, val] of Object.entries({ from, to, cfrom, cto })) {
    if (!DATE_RE.test(val)) return badRequest(`Invalid ${name}: expected YYYY-MM-DD, got "${val}"`);
  }
  if (from > to) return badRequest("`from` must not be after `to`");
  if (cfrom > cto) return badRequest("`cfrom` must not be after `cto`");

  // ── Demo mode: synthetic data, no Shopify calls ────────────────────
  if (mock) {
    const built = buildMockPayload({ from, to }, { from: cfrom, to: cto }, p.get("granularity"));
    return Response.json({
      range: { from, to },
      compare: { from: cfrom, to: cto },
      granularity: built.granularity,
      stores: built.stores,
      byStore: built.byStore,
      all: consolidate(built.byStore, built.stores),
      warnings: [{
        store: "demo",
        dataset: "all",
        code: "MOCK_DATA",
        message: "Showing synthetic demo data — no Shopify store is connected yet. Numbers are generated, not real.",
      }],
      failedStores: [],
      meta: { elapsedMs: Date.now() - started, mock: true, storesReturned: built.stores.length },
      lastUpdated: new Date().toISOString(),
    });
  }

  const requested = (p.get("stores") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const selected = requested.length > 0 ? stores.filter((s) => requested.includes(s.key)) : stores;
  if (selected.length === 0) return badRequest("None of the requested store keys exist");

  const granularity = pickGranularity(from, to, p.get("granularity"));
  const forceRefresh = p.get("refresh") === "1";

  // Each store has its own ShopifyQL budget, so stores run in parallel;
  // queries within a store are throttled inside fetchStoreData.
  const storeConcurrency = Math.min(
    selected.length,
    parseInt(process.env.STORE_CONCURRENCY || "6", 10) || 6
  );

  // The dimensional breakdowns are only worth fetching for the tab being viewed.
  // Omit `include` and both are fetched, which keeps older clients working.
  const rawInclude = p.get("include");
  const include = rawInclude === null
    ? { traffic: true, campaigns: true }
    : {
        traffic: rawInclude.split(",").map((s) => s.trim()).includes("traffic"),
        campaigns: rawInclude.split(",").map((s) => s.trim()).includes("campaigns"),
      };

  const settled = await mapLimit(selected, storeConcurrency, (store) =>
    fetchStoreDataServed(
      store,
      { from, to },
      { from: cfrom, to: cto },
      { granularity, forceRefresh, include, forceLive: p.get("live") === "1" }
    )
  );

  const byStore = {};
  const warnings = [];
  const failedStores = [];
  const sources = {};

  selected.forEach((store, i) => {
    const r = settled[i];
    if (r && r.ok) {
      byStore[store.key] = r.value.data;
      sources[store.key] = r.value.source;
      warnings.push(...r.value.warnings);
    } else {
      failedStores.push({
        store: store.key,
        label: store.label,
        message: r?.error?.message || "Unknown error",
        code: r?.error?.code || "ERROR",
      });
    }
  });

  const publicStores = selected
    .filter((s) => byStore[s.key])
    .map(({ key, label, color, icon, domain, group }) => ({ key, label, color, icon, domain, group }));
  const all = consolidate(byStore, publicStores);

  return Response.json(
    {
      range: { from, to },
      compare: { from: cfrom, to: cto },
      granularity,
      stores: publicStores,
      byStore,
      all,
      warnings,
      failedStores,
      meta: {
        elapsedMs: Date.now() - started,
        cache: cacheStats(),
        storesRequested: selected.length,
        storesReturned: publicStores.length,
        database: dbAvailable() ? "connected" : "not configured",
        sources, // per store: "db" | "live" | "live-fallback"
        include,
      },
      lastUpdated: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Elapsed-Ms": String(Date.now() - started),
      },
    }
  );
}
