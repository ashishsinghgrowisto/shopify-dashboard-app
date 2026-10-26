// lib/filters.js
// Dashboard filters → ShopifyQL WHERE fragments.
//
// Each filter maps to a dimension on the `sessions` schema, the `sales` schema,
// or both. A filter that a schema can't express is reported back so the UI can
// say "revenue isn't narrowed by landing page type" instead of quietly showing
// unfiltered numbers as if they were filtered.
//
// Field names verified against the 2026-07 ShopifyQL schemas:
//   sessions: traffic_type, referrer_source, referring_medium, landing_page_type
//   sales:    sales_channel, traffic_type, order_referrer_source, referring_medium
// Sessions are Online Store visits only, so there is no sales channel on them.

export const FILTER_DEFS = {
  channel: { label: "Sales channel", sessions: null, sales: "sales_channel" },
  traffic: { label: "Traffic type", sessions: "traffic_type", sales: "traffic_type" },
  source: { label: "Referrer source", sessions: "referrer_source", sales: "order_referrer_source" },
  medium: { label: "Referrer medium", sessions: "referring_medium", sales: "referring_medium" },
  landing: { label: "Landing page type", sessions: "landing_page_type", sales: null },
};

export const FILTER_KEYS = Object.keys(FILTER_DEFS);

// Values come from the URL, so they're untrusted. Quotes and backslashes are
// stripped rather than escaped: no real dimension value contains them, and it
// keeps a crafted value from breaking out of the string literal.
function clean(v) {
  return String(v ?? "").replace(/['"\\]/g, "").trim().slice(0, 120);
}

/**
 * Parse `?filters=` (JSON: { channel: ["Online Store"], traffic: ["Paid"] }).
 * Unknown keys and empty arrays are dropped. Returns {} when nothing is active.
 */
export function parseFilters(raw) {
  if (!raw) return {};
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const key of FILTER_KEYS) {
    const vals = Array.isArray(obj[key]) ? obj[key] : obj[key] ? [obj[key]] : [];
    const cleaned = [...new Set(vals.map(clean).filter(Boolean))].slice(0, 25);
    if (cleaned.length) out[key] = cleaned;
  }
  return out;
}

export function hasFilters(filters) {
  return Boolean(filters) && Object.keys(filters).length > 0;
}

// Stable string for cache keys and logs
export function filtersKey(filters) {
  if (!hasFilters(filters)) return "";
  return FILTER_KEYS.filter((k) => filters[k]).map((k) => `${k}=${filters[k].join("|")}`).join(";");
}

/**
 * Build the condition list for one schema.
 * @param {"sessions"|"sales"} target
 * @returns {{ conds: string[], skipped: string[] }}
 */
export function conditionsFor(filters, target) {
  const conds = [];
  const skipped = [];
  if (!hasFilters(filters)) return { conds, skipped };
  for (const key of FILTER_KEYS) {
    const vals = filters[key];
    if (!vals || !vals.length) continue;
    const dim = FILTER_DEFS[key][target];
    if (!dim) {
      skipped.push(key);
      continue;
    }
    const parts = vals.map((v) => `${dim} = '${v}'`);
    conds.push(parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`);
  }
  return { conds, skipped };
}

/**
 * WHERE clause for a schema, merged with any base conditions the query already
 * needs (e.g. human_or_bot_session = 'human'). Returns "" when there's nothing.
 */
export function whereClause(filters, target, base = []) {
  const { conds } = conditionsFor(filters, target);
  const all = [...base, ...conds];
  return all.length ? `WHERE ${all.join(" AND ")}` : "";
}

// Human-readable note for the warnings list
export function skippedNote(filters, target) {
  const { skipped } = conditionsFor(filters, target);
  if (!skipped.length) return null;
  const names = skipped.map((k) => FILTER_DEFS[k].label.toLowerCase()).join(" and ");
  return target === "sessions"
    ? `Sessions and funnel figures can't be narrowed by ${names} — Shopify only records that on orders. Session numbers shown are for all Online Store visits matching the other filters.`
    : `Revenue and order figures can't be narrowed by ${names} — Shopify only records that on sessions. Sales shown match the other filters only.`;
}
