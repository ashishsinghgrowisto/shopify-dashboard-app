// lib/oauth-apps.js
// Credential lookup for multiple Shopify apps.
//
// Custom distribution binds one Shopify app to exactly one store, so connecting
// N client stores means N apps — each with its own client ID and secret. Stores
// are numbered by "slot", matching the STORE_n_* variables the dashboard reads.
//
//   slot 1 → SHOPIFY_API_KEY   / SHOPIFY_API_SECRET   (also accepts _1 suffix)
//   slot 2 → SHOPIFY_API_KEY_2 / SHOPIFY_API_SECRET_2
//   slot n → SHOPIFY_API_KEY_n / SHOPIFY_API_SECRET_n
//
// The slot travels through the OAuth round trip in the redirect URI
// (/api/auth/callback?slot=n) so the callback verifies the HMAC and exchanges
// the code against the same app that issued it.

export const MAX_SLOT = 40;

export function normalizeSlot(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > MAX_SLOT) return 1;
  return n;
}

export function getAppCredentials(slot) {
  const s = normalizeSlot(slot);

  // Slot 1 keeps the unsuffixed names so existing deployments don't break.
  const key =
    (s === 1 ? process.env.SHOPIFY_API_KEY : null) ||
    process.env[`SHOPIFY_API_KEY_${s}`] ||
    (s === 1 ? process.env.SHOPIFY_API_KEY_1 : null);

  const secret =
    (s === 1 ? process.env.SHOPIFY_API_SECRET : null) ||
    process.env[`SHOPIFY_API_SECRET_${s}`] ||
    (s === 1 ? process.env.SHOPIFY_API_SECRET_1 : null);

  return {
    slot: s,
    apiKey: (key || "").trim(),
    apiSecret: (secret || "").trim(),
    configured: Boolean(key && secret),
  };
}

// Which slots currently have a full credential pair — used for error messages.
export function configuredSlots() {
  const out = [];
  for (let s = 1; s <= MAX_SLOT; s++) {
    if (getAppCredentials(s).configured) out.push(s);
  }
  return out;
}

// The next free slot, so a new store doesn't overwrite an existing one.
export function suggestNextSlot() {
  for (let s = 1; s <= MAX_SLOT; s++) {
    const hasStore = process.env[`STORE_${s}_DOMAIN`];
    if (!hasStore) return s;
  }
  return MAX_SLOT;
}
