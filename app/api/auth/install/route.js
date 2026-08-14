// app/api/auth/install/route.js
// Starts the Shopify OAuth install for one store.
//
//   /api/auth/install?shop=clientstore.myshopify.com
//
// Only needed if you distribute this as a real Shopify app. If you configure
// stores with STORE_n_* env vars instead, you never touch this route.

import crypto from "crypto";

export const dynamic = "force-dynamic";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
export const SCOPES = process.env.SHOPIFY_SCOPES || "read_reports";

export async function GET(request) {
  const url = new URL(request.url);
  const shop = (url.searchParams.get("shop") || "").trim().toLowerCase();

  const apiKey = process.env.SHOPIFY_API_KEY;
  if (!apiKey || !process.env.SHOPIFY_API_SECRET) {
    return Response.json(
      {
        error: "OAuth is not configured",
        hint: "Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET, or configure stores with STORE_n_* env vars instead.",
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
  const redirectUri = `${url.origin}/api/auth/callback`;

  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set("client_id", apiKey);
  authorize.searchParams.set("scope", SCOPES);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);

  const res = Response.redirect(authorize.toString(), 302);
  const headers = new Headers(res.headers);
  headers.append(
    "Set-Cookie",
    `shopify_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`
  );
  return new Response(null, { status: 302, headers });
}
