import { getSql, dbAvailable } from "../../../lib/db";
import { decryptToken } from "../../../lib/crypto";

export const dynamic = "force-dynamic";

export async function GET() {
    if (!dbAvailable()) return Response.json({ dbAvailable: false });
    const out = {};
    const sql = getSql();

  const rows = await sql`SELECT shop_domain, store_key, label, access_token, scope, installed_at::text, updated_at::text FROM installs WHERE uninstalled_at IS NULL ORDER BY installed_at ASC`;

  out.count = rows.length;
    out.columnsSeen = rows.length ? Object.keys(rows[0]) : [];

  out.perRow = rows.map(function (row) {
        const info = {
                shop: row.shop_domain,
                tokenType: typeof row.access_token,
                tokenLen: row.access_token == null ? null : String(row.access_token).length,
                tokenHead: row.access_token == null ? null : String(row.access_token).slice(0, 3),
                labelNull: row.label === null,
                storeKeyNull: row.store_key === null
        };
        try {
                const t = decryptToken(row.access_token);
                info.decrypt = t && String(t).startsWith("shp") ? "ok" : "unexpected";
        } catch (err) {
                info.decrypt = "THREW: " + err.message;
        }
        return info;
  });

  return Response.json(out);
}
