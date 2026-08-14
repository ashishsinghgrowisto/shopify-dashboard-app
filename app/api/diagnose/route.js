// app/api/diagnose/route.js
// Connection tester. Hit this first after adding a store — it probes every
// ShopifyQL dataset the dashboard uses and reports exactly which ones work,
// which columns came back, and the precise error if one fails.
//
// GET /api/diagnose            → probe every configured store
// GET /api/diagnose?store=cp   → probe one store

import { getAllStores } from "../../../lib/stores";
import { probeStore } from "../../../lib/queries";
import { mapLimit, API_VERSION } from "../../../lib/shopifyql";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  const url = new URL(request.url);
  const wanted = url.searchParams.get("store");

  const all = await getAllStores();
  const stores = wanted ? all.filter((s) => s.key === wanted) : all;

  if (all.length === 0) {
    return Response.json(
      {
        apiVersion: API_VERSION,
        error: "No stores configured",
        hint:
          "Set STORE_1_LABEL / STORE_1_DOMAIN / STORE_1_TOKEN (or the SHOPIFY_STORES JSON array) in your environment.",
      },
      { status: 500 }
    );
  }

  if (stores.length === 0) {
    return Response.json(
      { error: `No store with key "${wanted}"`, available: all.map((s) => s.key) },
      { status: 404 }
    );
  }

  const results = await mapLimit(stores, 3, (s) => probeStore(s));

  const report = results.map((r, i) =>
    r.ok
      ? r.value
      : {
          store: { key: stores[i].key, label: stores[i].label, domain: stores[i].domain },
          fatal: r.error?.message || "Unknown error",
        }
  );

  const anyOk = report.some((r) => (r.probes || []).some((p) => p.ok));

  return Response.json({
    apiVersion: API_VERSION,
    storesConfigured: all.length,
    verdict: anyOk
      ? "At least one dataset returned data. Check each probe below — a failing probe only disables that part of the dashboard."
      : "No dataset returned data on any store. If the error says ACCESS_DENIED, the app is missing the read_reports scope or Level 2 protected customer data access.",
    report,
  });
}
