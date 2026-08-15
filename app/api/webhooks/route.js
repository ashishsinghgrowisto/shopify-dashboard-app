// app/api/webhooks/route.js
// Every webhook Shopify sends this app, on one endpoint.
//
// Topics handled:
//   app/uninstalled          — revoke the store so we stop querying a dead token
//   customers/data_request   — GDPR: merchant asks what we hold on a customer
//   customers/redact         — GDPR: erase a customer's data
//   shop/redact              — GDPR: erase a shop's data, 48h after uninstall
//
// The three customers/* and shop/* topics are mandatory for public distribution;
// an app that doesn't answer them does not pass review.
//
// Two things matter for correctness here:
//
//   1. HMAC is computed over the RAW body. Parse first and the bytes change
//      (key order, whitespace) and every signature fails. So: text(), verify,
//      then parse.
//   2. Verification failure returns 401, but any *handled* topic returns 200
//      even if the work is a no-op. Shopify retries non-2xx for 48 hours and
//      removes the subscription after repeated failure.

import crypto from "crypto";
import { markUninstalled } from "../../../lib/token-store";
import { allAppSecrets } from "../../../lib/oauth-apps";
import { dbAvailable, getSql } from "../../../lib/db";

export const dynamic = "force-dynamic";

function verify(rawBody, providedB64) {
  if (!providedB64) return false;
  const provided = Buffer.from(providedB64, "base64");

  // Try every app's secret: one deployment serves the public app and the
  // older custom apps at once. timingSafeEqual needs equal lengths.
  for (const secret of allAppSecrets()) {
    const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest();
    if (digest.length === provided.length && crypto.timingSafeEqual(digest, provided)) {
      return true;
    }
  }
  return false;
}

// What this app actually stores, per shop:
//   installs      — the shop domain, a display label, and its access token
//   daily_metrics — one row per shop per day of aggregate totals
//                   (sessions, orders, net sales). No customer rows, ever.
async function purgeShop(shopDomain) {
  if (!dbAvailable()) return { installs: 0, metrics: 0 };
  const sql = getSql();

  const storeKey = String(shopDomain || "").replace(/\.myshopify\.com$/, "");
  await sql.query(`DELETE FROM installs WHERE shop_domain = $1`, [shopDomain]);
  await sql.query(`DELETE FROM daily_metrics WHERE store_key = $1 OR shop_domain = $2`, [
    storeKey,
    shopDomain,
  ]);
  return { purged: true };
}

export async function POST(request) {
  const raw = await request.text();
  const topic = request.headers.get("x-shopify-topic") || "";
  const shop = (request.headers.get("x-shopify-shop-domain") || "").toLowerCase();
  const hmac = request.headers.get("x-shopify-hmac-sha256");

  if (!verify(raw, hmac)) {
    console.warn(`[webhooks] Rejected unverified ${topic || "(no topic)"} from ${shop || "(no shop)"}`);
    return new Response("Unauthorized", { status: 401 });
  }

  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    // A verified-but-unparseable body is Shopify's problem, not something to
    // retry against. Acknowledge and move on.
    console.error(`[webhooks] ${topic} from ${shop} had an unparseable body`);
    return new Response("OK", { status: 200 });
  }

  try {
    switch (topic) {
      case "app/uninstalled": {
        // The token is already dead on Shopify's side. Drop it so the nightly
        // sync stops burning a request on this store every night.
        await markUninstalled(shop);
        console.log(`[webhooks] ${shop} uninstalled — token revoked, history retained`);
        break;
      }

      case "customers/data_request": {
        // Nothing to assemble: this app reads aggregate analytics only, and
        // holds no customer-level records to hand back. Logged so there's an
        // audit trail if a merchant ever asks what happened to their request.
        console.log(
          `[webhooks] customers/data_request for ${shop} (customer ${payload?.customer?.id ?? "?"}) — ` +
            "no customer-level data is stored by this app"
        );
        break;
      }

      case "customers/redact": {
        // Same reasoning: there is no per-customer row to erase. Daily metrics
        // are shop-level totals and cannot identify a customer.
        console.log(
          `[webhooks] customers/redact for ${shop} (customer ${payload?.customer?.id ?? "?"}) — ` +
            "nothing to erase; stored data is shop-level aggregates only"
        );
        break;
      }

      case "shop/redact": {
        // This one does delete: 48 hours after uninstall, erase the shop.
        await purgeShop(shop);
        console.log(`[webhooks] shop/redact for ${shop} — install and synced metrics deleted`);
        break;
      }

      default:
        console.log(`[webhooks] Unhandled topic ${topic} from ${shop}`);
    }
  } catch (err) {
    // Returning 500 makes Shopify retry, which is right for a transient
    // database failure on a redaction we are obliged to complete.
    console.error(`[webhooks] ${topic} for ${shop} failed:`, err.message);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}

// Shopify only ever POSTs. A GET is a human checking the endpoint exists.
export async function GET() {
  return Response.json({
    endpoint: "shopify webhooks",
    topics: ["app/uninstalled", "customers/data_request", "customers/redact", "shop/redact"],
    note: "POST only, HMAC-verified.",
  });
}
