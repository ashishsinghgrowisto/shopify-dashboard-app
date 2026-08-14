// app/api/auth/callback/route.js
// Completes Shopify OAuth: verifies the request came from Shopify, exchanges the
// code for a permanent (offline) Admin API token, and stores it.

import crypto from "crypto";
import { saveShop, tokenStoreBackend } from "../../../../lib/token-store";

export const dynamic = "force-dynamic";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

// Shopify signs the query string; recompute the HMAC over everything except hmac/signature.
function verifyHmac(searchParams, secret) {
  const provided = searchParams.get("hmac");
  if (!provided) return false;

  const pairs = [];
  searchParams.forEach((value, key) => {
    if (key === "hmac" || key === "signature") return;
    pairs.push([key, value]);
  });
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = pairs.map(([k, v]) => `${k}=${v}`).join("&");

  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  const match = raw.split(/;\s*/).find((c) => c.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function fail(message, status = 400, extra = {}) {
  return Response.json({ error: message, ...extra }, { status });
}

export async function GET(request) {
  const url = new URL(request.url);
  const p = url.searchParams;

  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!apiKey || !apiSecret) return fail("OAuth is not configured on this deployment", 500);

  const shop = (p.get("shop") || "").toLowerCase();
  const code = p.get("code");
  const state = p.get("state");

  if (!SHOP_RE.test(shop)) return fail("Invalid shop domain");
  if (!code) return fail("Missing authorization code");

  if (!verifyHmac(p, apiSecret)) {
    return fail("HMAC verification failed — this request did not come from Shopify", 401);
  }

  const expectedState = readCookie(request, "shopify_oauth_state");
  if (!expectedState || !state || state !== expectedState) {
    return fail("State mismatch — possible CSRF, or the install link was reused. Start again from /api/auth/install.", 401);
  }

  // Exchange the code for a permanent offline access token
  let tokenPayload;
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
    });
    if (!res.ok) {
      return fail(`Token exchange failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`, 502);
    }
    tokenPayload = await res.json();
  } catch (err) {
    return fail("Token exchange request failed: " + err.message, 502);
  }

  if (!tokenPayload?.access_token) return fail("Shopify did not return an access token", 502);

  const scopes = String(tokenPayload.scope || "");
  const warnings = [];
  if (!scopes.split(",").includes("read_reports")) {
    warnings.push(
      "The granted scopes do not include read_reports, which ShopifyQL analytics requires. Update the app's scopes and reinstall."
    );
  }
  if (tokenStoreBackend() === "memory") {
    warnings.push(
      "No KV backend is configured, so this token is only held in memory and will be lost shortly. Set KV_REST_API_URL and KV_REST_API_TOKEN to persist installs."
    );
  }

  try {
    await saveShop({ shop, token: tokenPayload.access_token, scope: scopes });
  } catch (err) {
    return fail("Could not persist the store token: " + err.message, 500);
  }

  const target = new URL("/", url.origin);
  target.searchParams.set("installed", shop);
  if (warnings.length) target.searchParams.set("warn", warnings.join(" | "));

  const headers = new Headers({ Location: target.toString() });
  headers.append("Set-Cookie", "shopify_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
  return new Response(null, { status: 302, headers });
}
