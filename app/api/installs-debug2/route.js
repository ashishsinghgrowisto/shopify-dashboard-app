import { getSql, dbAvailable } from "../../../lib/db";
import { getAllStores, getStores } from "../../../lib/stores";
import { listShops } from "../../../lib/token-store";

export const dynamic = "force-dynamic";

export async function GET() {
    const out = {};

  try {
        const env = getStores();
        out.envStoreDomains = env.map(function (s) { return s.domain; });
  } catch (err) {
        out.envError = err.message;
  }

  try {
        const recs = await listShops();
        out.listShopsCount = recs.length;
        out.listShopsDetail = recs.map(function (r) {
                return { shop: r.shop, storeKey: r.storeKey, hasToken: Boolean(r.token) };
        });
  } catch (err) {
        out.listShopsError = err.message;
  }

  try {
        const stores = await getAllStores();
        out.visibleKeys = stores.map(function (s) { return s.key; });
  } catch (err) {
        out.storesError = err.message;
  }

  if (dbAvailable()) {
        try {
                const sql = getSql();
                const all = await sql`SELECT shop_domain, uninstalled_at FROM installs ORDER BY installed_at ASC`;
                const filtered = await sql`SELECT shop_domain FROM installs WHERE uninstalled_at IS NULL ORDER BY installed_at ASC`;
                out.rawAll = all.map(function (r) { return r.shop_domain + " | uninstalled_at=" + String(r.uninstalled_at); });
                out.rawFilteredCount = filtered.length;
                out.rawFiltered = filtered.map(function (r) { return r.shop_domain; });
        } catch (err) {
                out.queryError = err.message;
        }
  }

  return Response.json(out);
}
