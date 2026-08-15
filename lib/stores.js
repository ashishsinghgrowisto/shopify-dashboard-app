// lib/stores.js
// The store registry. Every connected Shopify store is defined here, sourced from
// environment variables so no credentials ever live in the repo.
//
// Two supported formats (use either, or mix):
//
// 1) JSON array in a single env var — easiest for many stores:
//    SHOPIFY_STORES='[{"key":"cp","label":"ColorProof","domain":"colorproof.myshopify.com","token":"shpat_xxx"}]'
//
// 2) Numbered env vars — easiest to edit in the Vercel UI one store at a time:
//    STORE_1_KEY=cp
//    STORE_1_LABEL=ColorProof
//    STORE_1_DOMAIN=colorproof.myshopify.com
//    STORE_1_TOKEN=shpat_xxxxxxxxxxxx
//    STORE_2_... etc (scans STORE_1 through STORE_40)
//
// A store only needs LABEL, DOMAIN and TOKEN. `key` is auto-derived from the
// label when omitted, and `color` is auto-assigned from the palette below.

const PALETTE = [
  "#818CF8", // indigo
  "#34D399", // emerald
  "#F9A8D4", // pink
  "#C084FC", // purple
  "#2DD4BF", // teal
  "#FB7185", // rose
  "#FBBF24", // amber
  "#60A5FA", // blue
  "#A3E635", // lime
  "#F472B6", // fuchsia
  "#22D3EE", // cyan
  "#FCA5A5", // salmon
];

const MAX_NUMBERED_STORES = 40;

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
}

function normalizeDomain(domain) {
  if (!domain) return "";
  return String(domain)
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function initialsOf(label) {
  const words = String(label || "?").trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const w = words[0];
    // "ColorProof" -> "CP" by capital letters, else first 2 chars
    const caps = w.match(/[A-Z0-9]/g);
    if (caps && caps.length >= 2) return caps.slice(0, 2).join("");
    return w.slice(0, 2).toUpperCase();
  }
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function fromJsonEnv() {
  const raw = process.env.SHOPIFY_STORES;
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error("[stores] SHOPIFY_STORES must be a JSON array — ignoring");
      return [];
    }
    return parsed;
  } catch (err) {
    console.error("[stores] SHOPIFY_STORES is not valid JSON:", err.message);
    return [];
  }
}

function fromNumberedEnv() {
  const out = [];
  for (let i = 1; i <= MAX_NUMBERED_STORES; i++) {
    const domain = process.env[`STORE_${i}_DOMAIN`];
    const token = process.env[`STORE_${i}_TOKEN`];
    if (!domain && !token) continue;
    out.push({
      key: process.env[`STORE_${i}_KEY`],
      label: process.env[`STORE_${i}_LABEL`],
      domain,
      token,
      color: process.env[`STORE_${i}_COLOR`],
      group: process.env[`STORE_${i}_GROUP`],
    });
  }
  return out;
}

let cachedStores = null;

// Full store records — INCLUDING access tokens. Server-side only.
// Never return the result of this straight to the browser.
export function getStores() {
  if (cachedStores) return cachedStores;

  const raw = [...fromJsonEnv(), ...fromNumberedEnv()];
  const seenKeys = new Set();
  const stores = [];

  raw.forEach((entry, idx) => {
    const domain = normalizeDomain(entry.domain);
    const token = (entry.token || "").trim();
    const label = (entry.label || domain.replace(/\.myshopify\.com$/, "") || `Store ${idx + 1}`).trim();

    if (!domain || !token) {
      console.warn(`[stores] Skipping "${label}" — missing domain or token`);
      return;
    }

    let key = slugify(entry.key || label) || `s${idx + 1}`;
    while (seenKeys.has(key)) key = key + "x";
    seenKeys.add(key);

    stores.push({
      key,
      label,
      domain,
      token,
      color: entry.color || PALETTE[stores.length % PALETTE.length],
      icon: initialsOf(label),
      group: entry.group || null,
    });
  });

  cachedStores = stores;
  return stores;
}

// Safe subset for the client — no tokens.
export function getPublicStores() {
  return getStores().map(({ key, label, color, icon, domain, group }) => ({
    key,
    label,
    color,
    icon,
    group,
    domain,
  }));
}

export function getStoreByKey(key) {
  return getStores().find((s) => s.key === key) || null;
}

// ══════════════════════════════════════════════════════════════════
// Env stores + OAuth-installed stores, merged
// ══════════════════════════════════════════════════════════════════
// Env-configured stores win on conflict: they're explicit and reviewable.

export async function getAllStores() {
  const envStores = getStores();

  let installed = [];
  try {
    const { listShops } = await import("./token-store");
    installed = await listShops();
  } catch (err) {
    console.warn("[stores] Could not read OAuth store records:", err.message);
    return envStores;
  }

  const byDomain = new Set(envStores.map((s) => s.domain));
  const seenKeys = new Set(envStores.map((s) => s.key));
  const merged = [...envStores];

  installed.forEach((rec) => {
    const domain = normalizeDomain(rec.shop);
    if (!domain || !rec.token || byDomain.has(domain)) return;
    // Key off the myshopify handle, never the merchant's display name. The
    // handle is stable and unique; a display name is neither, and every synced
    // row in daily_metrics is filed under this key. A store that moves from a
    // custom app to the public app must land on the same key or its history
    // silently detaches.
    let key = slugify(rec.storeKey || domain.replace(/\.myshopify\.com$/, "")) || domain.slice(0, 8);
    while (seenKeys.has(key)) key = key + "x";
    seenKeys.add(key);
    merged.push({
      key,
      label: rec.label || domain.replace(/\.myshopify\.com$/, ""),
      domain,
      token: rec.token,
      color: PALETTE[merged.length % PALETTE.length],
      icon: initialsOf(rec.label || domain),
      group: null,
      viaOAuth: true,
    });
  });

  return merged;
}

export async function getAllPublicStores() {
  const all = await getAllStores();
  return all.map(({ key, label, color, icon, domain, group }) => ({
    key, label, color, icon, domain, group,
  }));
}

// Used by tests / diagnostics
export function resetStoreCache() {
  cachedStores = null;
}
