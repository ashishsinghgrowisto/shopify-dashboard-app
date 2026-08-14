// lib/token-store.js
// Persistence for OAuth-installed stores.
//
// Two backends, chosen automatically:
//   1. Upstash Redis / Vercel KV — set KV_REST_API_URL + KV_REST_API_TOKEN
//      (Vercel's Upstash integration sets these for you; no npm package needed,
//      it's a plain REST API.)
//   2. In-memory — a development fallback ONLY. Serverless instances are
//      recycled constantly, so tokens saved here vanish. The app logs loudly.
//
// If you never use the OAuth install flow (i.e. every store is configured through
// STORE_n_* env vars), this file is inert and no KV setup is required.

const KEY_PREFIX = "shop:";
const INDEX_KEY = "shops:index";

const memory = new Map();
let warnedAboutMemory = false;

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function tokenStoreBackend() {
  return kvConfig() ? "kv" : "memory";
}

async function kvCommand(cmd) {
  const cfg = kvConfig();
  if (!cfg) return null;
  const res = await fetch(cfg.url + "/pipeline", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([cmd]),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`KV request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json();
  const first = Array.isArray(json) ? json[0] : json;
  if (first?.error) throw new Error("KV error: " + first.error);
  return first?.result ?? null;
}

function warnMemory() {
  if (warnedAboutMemory) return;
  warnedAboutMemory = true;
  console.warn(
    "[token-store] No KV backend configured — OAuth-installed store tokens are being kept " +
      "in memory and WILL be lost when this serverless instance recycles. Set KV_REST_API_URL " +
      "and KV_REST_API_TOKEN (Vercel → Storage → Upstash Redis), or configure stores via " +
      "STORE_n_* environment variables instead."
  );
}

export async function saveShop({ shop, token, label, scope }) {
  const record = {
    shop,
    token,
    label: label || shop.replace(/\.myshopify\.com$/, ""),
    scope: scope || "",
    installedAt: new Date().toISOString(),
  };

  if (!kvConfig()) {
    warnMemory();
    memory.set(shop, record);
    return record;
  }

  await kvCommand(["SET", KEY_PREFIX + shop, JSON.stringify(record)]);
  await kvCommand(["SADD", INDEX_KEY, shop]);
  return record;
}

export async function getShop(shop) {
  if (!kvConfig()) {
    warnMemory();
    return memory.get(shop) || null;
  }
  const raw = await kvCommand(["GET", KEY_PREFIX + shop]);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export async function listShops() {
  if (!kvConfig()) {
    warnMemory();
    return [...memory.values()];
  }
  const domains = (await kvCommand(["SMEMBERS", INDEX_KEY])) || [];
  const records = [];
  for (const domain of domains) {
    const rec = await getShop(domain);
    if (rec) records.push(rec);
  }
  return records;
}

export async function deleteShop(shop) {
  if (!kvConfig()) {
    memory.delete(shop);
    return;
  }
  await kvCommand(["DEL", KEY_PREFIX + shop]);
  await kvCommand(["SREM", INDEX_KEY, shop]);
}
