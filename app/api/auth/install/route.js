// app/api/auth/install/route.js
// Starts the Shopify OAuth grant for one store.
//
//   /api/auth/install?shop=clientstore.myshopify.com          → slot 1
//   /api/auth/install?shop=clientstore.myshopify.com&slot=2   → slot 2
//
// The slot selects which Shopify app's credentials to use, and determines which
// STORE_n_* variables the callback prints. Custom-distribution apps must be
// installed once via the signed link from Partners → Distribution BEFORE this
// route will work — Shopify rejects a plain authorize URL for an app that the
// store hasn't installed yet.

import crypto from "crypto";
import { getAppCredentials, normalizeSlot, configuredSlots } from "../../../../lib/oauth-apps";

export const dynamic = "force-dynamic";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
export const SCOPES = process.env.SHOPIFY_SCOPES || "read_reports";

export async function GET(request) {
  const url = new URL(request.url);
  const shop = (url.searchParams.get("shop") || "").trim().toLowerCase();
  const slot = normalizeSlot(url.searchParams.get("slot"));

  const { apiKey, apiSecret, configured } = getAppCredentials(slot);

  if (!configured) {
    const suffix = slot === 1 ? "" : `_${slot}`;
    return Response.json(
      {
        error: `OAuth is not configured for slot ${slot}`,
        hint:
          `Set SHOPIFY_API_KEY${suffix} and SHOPIFY_API_SECRET${suffix} to this store's ` +
          `Shopify app credentials (Dev Dashboard → the app → Settings → Credentials), then redeploy.`,
        slotsConfigured: configuredSlots(),
      },
      { status: 500 }
    );
  }

  if (!SHOP_RE.test(shop)) {
    return Response.json(
      { error: "Invalid shop domain", hint: "Expected something like clientstore.myshopify.com" },
      { status: 400 }
    );
  }

  const state = crypto.randomBytes(24).toString("hex");

  // The slot rides along in the redirect URI so the callback knows which app's
  // secret to verify against. This exact URL must be listed in the app's
  // allowed redirection URLs.
  const redirectUri = `${url.origin}/api/auth/callback?slot=${slot}`;

  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set("client_id", apiKey);
  authorize.searchParams.set("scope", SCOPES);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);

  const headers = new Headers({ Location: authorize.toString() });
  headers.append(
    "Set-Cookie",
    `shopify_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`
  );
  // Remember the slot server-side too, so a tampered redirect can't switch apps.
  headers.append(
    "Set-Cookie",
    `shopify_oauth_slot=${slot}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`
  );
  return new Response(null, { status: 302, headers });
}
