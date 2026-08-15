// lib/token-store.js
// Persistence for OAuth-installed stores.
//
// Three backends, chosen in this order:
//   1. Postgres — the same Neon database the synced metrics live in. This is the
//      one that makes a public app viable: a merchant clicks Install and the
//      store is queryable on the next request, with nobody editing env vars.
//   2. Upstash Redis / Vercel KV — set KV_REST_API_URL + KV_REST_API_TOKEN.
//      Kept for deployments that had it before Postgres existed.
//   3. In-memory — a development fallback ONLY. Serverless instances are
//      recycled constantly, so tokens saved here vanish. The app logs loudly.
//
// Access tokens are encrypted before they are written and decrypted on read;
// see lib/crypto.js. Nothing above this layer ever sees ciphertext.

import { getSql, dbAvailable } from "./db";
import { encryptToken, decryptToken } from "./crypto";

const KEY_PREFIX = "shop:";
const INDEX_KEY = "shops:index";

const memory = new Map();
let warnedAboutMemory = false;
let installsSchemaReady = false;

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function tokenStoreBackend() {
  if (dbAvailable()) return "postgres";
  if (kvConfig()) return "kv";
  return "memory";
}

// True when an install will actually survive. The OAuth callback branches on
// this: if nothing can persist, it must hand the token to a human instead of
// pretending the store is connected.
export function tokenStorePersists() {
  return tokenStoreBackend() !== "memory";
}

// ══════════════════════════════════════════════════════════════════
// Postgres backend
// ══════════════════════════════════════════════════════════════════
// `store_key` is derived from the myshopify handle rather than the shop's
// display name, and is written once at install time. That is what lets a store
// move from a custom app to the public app without orphaning its synced
// history — same handle, same key, same rows in daily_metrics.

async function ensureInstallsSchema() {
  const sql = getSql();
  if (!sql) return false;
  if (installsSchemaReady) return true;

  await sql`
    CREATE TABLE IF NOT EXISTS installs (
      shop_domain    text        PRIMARY KEY,
      store_key      text        NOT NULL,
      label          text        NOT NULL,
      access_token   text        NOT NULL,
      scope          text,
      installed_at   timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now(),
      uninstalled_at timestamptz
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS installs_active_idx
      ON installs (uninstalled_at) WHERE uninstalled_at IS NULL
  `;

  installsSchemaReady = true;
  return true;
}

function handleOf(shop) {
  return String(shop || "").replace(/\.myshopify\.com$/, "");
}

function rowToRecord(row) {
  return {
    shop: row.shop_domain,
    storeKey: row.store_key,
    token: decryptToken(row.access_token),
    label: row.label,
    scope: row.scope || "",
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

// ══════════════════════════════════════════════════════════════════
// KV backend
// ══════════════════════════════════════════════════════════════════

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
    "[token-store] No database or KV backend configured — OAuth-installed store " +
      "tokens are being kept in memory and WILL be lost when this serverless " +
      "instance recycles. Set DATABASE_URL (Vercel → Storage → Neon), or configure " +
      "stores via STORE_n_* environment variables instead."
  );
}

// ══════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════

export async function saveShop({ shop, token, label, scope }) {
  const domain = String(shop || "").toLowerCase();
  const record = {
    shop: domain,
    storeKey: handleOf(domain),
    token,
    label: label || handleOf(domain),
    scope: scope || "",
    installedAt: new Date().toISOString(),
  };

  if (dbAvailable()) {
    await ensureInstallsSchema();
    const sql = getSql();
    // A reinstall re-runs OAuth and mints a fresh token. Keep the original
    // installed_at and store_key so the store's identity — and everything keyed
    // to it — survives an uninstall/reinstall cycle.
    await sql.query(
      `INSERT INTO installs (shop_domain, store_key, label, access_token, scope, uninstalled_at)
       VALUES ($1, $2, $3, $4, $5, NULL)
       ON CONFLICT (shop_domain) DO UPDATE SET
         label          = EXCLUDED.label,
         access_token   = EXCLUDED.access_token,
         scope          = EXCLUDED.scope,
         uninstalled_at = NULL,
         updated_at     = now()`,
      [domain, record.storeKey, record.label, encryptToken(token), record.scope]
    );
    return record;
  }

  if (!kvConfig()) {
    warnMemory();
    memory.set(domain, record);
    return record;
  }

  await kvCommand(["SET", KEY_PREFIX + domain, JSON.stringify(record)]);
  await kvCommand(["SADD", INDEX_KEY, domain]);
  return record;
}

export async function getShop(shop) {
  const domain = String(shop || "").toLowerCase();

  if (dbAvailable()) {
    await ensureInstallsSchema();
    const sql = getSql();
    const rows = await sql.query(
      `SELECT shop_domain, store_key, label, access_token, scope,
              installed_at::text, updated_at::text
       FROM installs
       WHERE shop_domain = $1 AND uninstalled_at IS NULL`,
      [domain]
    );
    const row = (Array.isArray(rows) ? rows[0] : rows?.rows?.[0]) || null;
    return row ? rowToRecord(row) : null;
  }

  if (!kvConfig()) {
    warnMemory();
    return memory.get(domain) || null;
  }
  const raw = await kvCommand(["GET", KEY_PREFIX + domain]);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export async function listShops() {
  if (dbAvailable()) {
    await ensureInstallsSchema();
    const sql = getSql();
    const rows = await sql`
      SELECT shop_domain, store_key, label, access_token, scope,
             installed_at::text, updated_at::text
      FROM installs
      WHERE uninstalled_at IS NULL
      ORDER BY installed_at ASC
    `;
    // One undecryptable row must not blank the whole dashboard.
    return rows.flatMap((row) => {
      try {
        return [rowToRecord(row)];
      } catch (err) {
        console.error(`[token-store] Could not decrypt token for ${row.shop_domain}:`, err.message);
        return [];
      }
    });
  }

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

// Called by the app/uninstalled webhook. Soft-delete: the merchant's synced
// metrics stay queryable for the agency's historical reporting, but the token
// is destroyed immediately — it is dead to Shopify the moment they uninstall,
// and keeping it serves no purpose.
export async function markUninstalled(shop) {
  const domain = String(shop || "").toLowerCase();

  if (dbAvailable()) {
    await ensureInstallsSchema();
    const sql = getSql();
    await sql.query(
      `UPDATE installs
       SET uninstalled_at = now(), access_token = '', updated_at = now()
       WHERE shop_domain = $1`,
      [domain]
    );
    return;
  }
  await deleteShop(domain);
}

export async function deleteShop(shop) {
  const domain = String(shop || "").toLowerCase();

  if (dbAvailable()) {
    await ensureInstallsSchema();
    const sql = getSql();
    await sql.query(`DELETE FROM installs WHERE shop_domain = $1`, [domain]);
    return;
  }
  if (!kvConfig()) {
    memory.delete(domain);
    return;
  }
  await kvCommand(["DEL", KEY_PREFIX + domain]);
  await kvCommand(["SREM", INDEX_KEY, domain]);
}
