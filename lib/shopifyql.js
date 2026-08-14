// lib/shopifyql.js
// Thin, careful client for Shopify's ShopifyQL analytics API (Admin GraphQL `shopifyqlQuery`).
//
// Things this handles that a naive fetch does not:
//  - ShopifyQL syntax errors come back as HTTP 200 with tableData:null + parseErrors[]
//  - shopifyqlQuery draws on TWO budgets (its own, smaller one + the shared GraphQL cost
//    budget). Either can 429. We back off using `windowResetAt` when present.
//  - Access failures surface as GraphQL errors with ACCESS_DENIED — usually a missing
//    read_reports scope or missing Level 2 protected customer data approval.
//  - Results are returned column-name keyed instead of positional arrays.
//
// Docs:
//  https://shopify.dev/docs/api/admin-graphql/latest/queries/shopifyqlQuery
//  https://shopify.dev/docs/apps/build/shopifyql/graphql-admin-api/errors-limits-and-performance

export const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

const GQL = `query RunShopifyQL($q: String!) {
  shopifyqlQuery(query: $q) {
    __typename
    parseErrors
    tableData {
      columns { name dataType displayName }
      rowData
    }
  }
}`;

class ShopifyQLError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = "ShopifyQLError";
    Object.assign(this, meta);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run one ShopifyQL query against one store.
 * @returns {Promise<{columns: string[], displayNames: string[], rows: object[], raw: any}>}
 */
export async function runShopifyQL(store, query, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 4;
  const url = `https://${store.domain}/admin/api/${API_VERSION}/graphql.json`;

  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": store.token,
          Accept: "application/json",
        },
        body: JSON.stringify({ query: GQL, variables: { q: query } }),
        // Vercel functions: don't let one slow store hang the whole dashboard
        signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 25000),
      });
    } catch (err) {
      lastErr = new ShopifyQLError(`Network error calling ${store.domain}: ${err.message}`, {
        store: store.key,
        retryable: true,
      });
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      throw lastErr;
    }

    // ── Hard HTTP failures ───────────────────────────────────────────────
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = parseFloat(res.headers.get("retry-after") || "0");
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 700 * 2 ** (attempt - 1));
      lastErr = new ShopifyQLError(
        `${store.domain} returned ${res.status} (throttled or upstream error)`,
        { store: store.key, status: res.status, retryable: true }
      );
      if (attempt < maxAttempts) {
        await sleep(waitMs);
        continue;
      }
      throw lastErr;
    }

    if (res.status === 401 || res.status === 403) {
      throw new ShopifyQLError(
        `${store.domain} rejected the access token (HTTP ${res.status}). Check the token is valid and the app has the read_reports scope.`,
        { store: store.key, status: res.status, retryable: false, code: "BAD_TOKEN" }
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ShopifyQLError(
        `${store.domain} returned HTTP ${res.status}: ${body.slice(0, 300)}`,
        { store: store.key, status: res.status, retryable: false }
      );
    }

    const json = await res.json().catch(() => null);
    if (!json) {
      throw new ShopifyQLError(`${store.domain} returned a non-JSON response`, {
        store: store.key,
        retryable: false,
      });
    }

    // ── GraphQL-level errors (auth, scopes, throttling) ─────────────────
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      const first = json.errors[0];
      const code = first?.extensions?.code || "";
      const msg = first?.message || "Unknown GraphQL error";

      if (code === "THROTTLED") {
        const resetAt = json.extensions?.shopifyqlCost?.windowResetAt;
        let waitMs = Math.min(10000, 800 * 2 ** (attempt - 1));
        if (resetAt) {
          const delta = new Date(resetAt).getTime() - Date.now();
          if (delta > 0) waitMs = Math.min(delta + 250, 15000);
        }
        lastErr = new ShopifyQLError(`${store.domain} throttled: ${msg}`, {
          store: store.key,
          retryable: true,
          code,
        });
        if (attempt < maxAttempts) {
          await sleep(waitMs);
          continue;
        }
        throw lastErr;
      }

      if (/access denied|ACCESS_DENIED/i.test(msg) || code === "ACCESS_DENIED") {
        throw new ShopifyQLError(
          `${store.domain}: access denied for shopifyqlQuery. This almost always means the app is missing the read_reports scope, or Level 2 protected customer data access has not been granted for this app. (Shopify applies the customer-data check to the shopifyqlQuery field itself, even for aggregate-only queries.)`,
          { store: store.key, retryable: false, code: "ACCESS_DENIED", detail: msg }
        );
      }

      throw new ShopifyQLError(`${store.domain}: ${msg}`, {
        store: store.key,
        retryable: false,
        code,
      });
    }

    const payload = json.data?.shopifyqlQuery;
    if (!payload) {
      throw new ShopifyQLError(`${store.domain} returned an empty shopifyqlQuery payload`, {
        store: store.key,
        retryable: false,
      });
    }

    // ── ShopifyQL syntax errors (HTTP 200!) ────────────────────────────
    if (Array.isArray(payload.parseErrors) && payload.parseErrors.length > 0) {
      throw new ShopifyQLError(
        `ShopifyQL syntax error: ${payload.parseErrors.join("; ")}`,
        { store: store.key, retryable: false, code: "PARSE_ERROR", query }
      );
    }

    const table = payload.tableData;
    if (!table) {
      // Valid query, genuinely no data for the range.
      return { columns: [], displayNames: [], rows: [], raw: payload, empty: true };
    }

    const columns = (table.columns || []).map((c) => c.name);
    const displayNames = (table.columns || []).map((c) => c.displayName || c.name);
    const rows = (table.rowData || []).map((row) => {
      const obj = {};
      columns.forEach((name, i) => {
        obj[name] = row[i];
      });
      return obj;
    });

    return { columns, displayNames, rows, raw: payload, empty: rows.length === 0 };
  }

  throw lastErr || new ShopifyQLError("ShopifyQL request failed", { store: store.key });
}

// ══════════════════════════════════════════════════════════════════════
// Caching
// ══════════════════════════════════════════════════════════════════════
// Keyed by store + exact query string, per Shopify's own guidance — a shared
// cache key across stores would return the wrong store's rows.
//
// Ranges that include today are volatile (today's totals climb as orders land),
// so they get a short TTL. Completed ranges are immutable and cached hard.

const cache = new Map();

const SHORT_TTL_MS = (parseInt(process.env.CACHE_TTL_LIVE || "300", 10) || 300) * 1000; // 5 min
const LONG_TTL_MS = (parseInt(process.env.CACHE_TTL_CLOSED || "21600", 10) || 21600) * 1000; // 6 h
const MAX_CACHE_ENTRIES = 800;

function ttlFor(query) {
  // If the query mentions today/now or an end date >= today, treat as volatile.
  if (/\b(today|now|this_month|this_week|this_year|this_quarter)\b/i.test(query)) {
    return SHORT_TTL_MS;
  }
  const dates = query.match(/\d{4}-\d{2}-\d{2}/g) || [];
  const todayStr = new Date().toISOString().slice(0, 10);
  if (dates.some((d) => d >= todayStr)) return SHORT_TTL_MS;
  return LONG_TTL_MS;
}

function prune() {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  // Drop oldest ~20%
  const entries = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
  entries.slice(0, Math.ceil(entries.length * 0.2)).forEach(([k]) => cache.delete(k));
}

export async function cachedShopifyQL(store, query, opts = {}) {
  const key = `${store.domain}::${query}`;
  const now = Date.now();
  const hit = cache.get(key);

  if (hit && !opts.forceRefresh && now - hit.at < hit.ttl) {
    return { ...hit.value, cached: true };
  }

  const value = await runShopifyQL(store, query, opts);
  cache.set(key, { at: now, ttl: ttlFor(query), value });
  prune();
  return { ...value, cached: false };
}

export function clearShopifyQLCache() {
  cache.clear();
}

export function cacheStats() {
  return { entries: cache.size };
}

export { ShopifyQLError };

// ══════════════════════════════════════════════════════════════════════
// Bounded parallelism
// ══════════════════════════════════════════════════════════════════════
// Fanning out unbounded across N stores x M queries would burn the ShopifyQL
// budget instantly. Each store has its own budget, so we cap per-store
// concurrency rather than globally.

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, error: err };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
