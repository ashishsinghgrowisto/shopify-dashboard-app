import { getSql, dbAvailable } from "../../../lib/db";
import { decryptToken } from "../../../lib/crypto";
import { getAllStores } from "../../../lib/stores";

export const dynamic = "force-dynamic";

export async function GET() {
    const conn = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
    const out = {
          dbAvailable: dbAvailable(),
          encryptionKeySet: Boolean(process.env.APP_ENCRYPTION_KEY),
          dbHost: conn ? conn.replace(/^.*@/, "").split("/")[0] : null,
          storeKeysVisibleToDashboard: [],
          rows: [],
    };

  try {
        const stores = await getAllStores();
        out.storeKeysVisibleToDashboard = stores.map(function (s) { return s.key; });
  } catch (err) {
        out.storesError = err.message;
  }

  if (!dbAvailable()) return Response.json(out);

  try {
        const sql = getSql();
        const rows = await sql`SELECT shop_domain, store_key, access_token, uninstalled_at FROM installs ORDER BY installed_at ASC`;
        out.rowCount = rows.length;
        out.rows = rows.map(function (row) {
                const stored = String(row.access_token || "");
                let status;
                try {
                          const t = decryptToken(row.access_token);
                          if (!t) status = "decrypted-empty";
                          else if (!String(t).startsWith("shp")) status = "decrypted-unexpected-prefix";
                          else status = "ok";
                } catch (err) {
                          status = "decrypt-failed: " + err.message;
                }
                return {
                          shop: row.shop_domain,
                          storeKey: row.store_key,
                          active: row.uninstalled_at === null,
                          encrypted: stored.slice(0, 3) === "v1:",
                          len: stored.length,
                          status: status,
                };
        });
  } catch (err) {
        out.queryError = err.message;
  }

  return Response.json(out);
}
