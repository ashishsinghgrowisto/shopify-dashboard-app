// app/api/auth/callback/route.js
// Completes Shopify OAuth: verifies the request came from Shopify, exchanges the
// code for a permanent (offline) Admin API token, and stores it.

import crypto from "crypto";
import { saveShop, tokenStorePersists } from "../../../../lib/token-store";
import { getAppCredentials, normalizeSlot } from "../../../../lib/oauth-apps";

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

  // Which Shopify app issued this code? The slot comes from the redirect URI,
  // cross-checked against the cookie set at install time so a tampered redirect
  // can't make us verify against a different app's secret.
  const slotFromQuery = normalizeSlot(p.get("slot"));
  const slotFromCookie = readCookie(request, "shopify_oauth_slot");
  const slot = slotFromCookie ? normalizeSlot(slotFromCookie) : slotFromQuery;

  if (slotFromCookie && normalizeSlot(slotFromCookie) !== slotFromQuery) {
    return fail("Slot mismatch between the install request and this callback", 401);
  }

  const { apiKey, apiSecret, configured } = getAppCredentials(slot);
  if (!configured) {
    return fail(`OAuth is not configured for slot ${slot} on this deployment`, 500);
  }

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
  if (!tokenStorePersists()) {
    warnings.push(
      "No database is configured, so this token is only held in memory and will be lost shortly. Set DATABASE_URL to persist installs."
    );
  }

  if (tokenStorePersists()) {
    try {
      await saveShop({ shop, token: tokenPayload.access_token, scope: scopes });
    } catch (err) {
      return fail("Could not persist the store token: " + err.message, 500);
    }

    // Always land on /installed — the neutral merchant page — never on "/".
    //
    // Under a public app, whoever finishes this flow is usually the merchant,
    // and "/" is the agency's cross-client portfolio. Redirecting there would
    // put every client's revenue one redirect away from the person who just
    // clicked Install. The agency reaches the dashboard by opening it directly;
    // nobody needs this redirect to be clever.
    const target = new URL("/installed", url.origin);
    target.searchParams.set("shop", shop);

    const headers = new Headers({ Location: target.toString() });
    headers.append("Set-Cookie", "shopify_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
    headers.append("Set-Cookie", "shopify_oauth_slot=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
    return new Response(null, { status: 302, headers });
  }

  // ── No KV configured: show the token once so it can go into env vars ──
  //
  // This is the deliberate default for the custom-distribution setup: one app
  // per client store, token pasted into STORE_n_TOKEN. Env vars are permanent
  // and need no external database. The token is rendered here exactly once —
  // it is never written to a log, a URL, or a query string.

  const label = shop.replace(/\.myshopify\.com$/, "");
  const html = renderTokenPage({
    shop,
    label,
    token: tokenPayload.access_token,
    scopes,
    index: slot,
    warnings,
  });

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    // Never let this page be cached or indexed
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  });
  headers.append("Set-Cookie", "shopify_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
  headers.append("Set-Cookie", "shopify_oauth_slot=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
  return new Response(html, { status: 200, headers });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function renderTokenPage({ shop, label, token, scopes, index, warnings }) {
  const envBlock =
    `STORE_${index}_LABEL=${label}\n` +
    `STORE_${index}_DOMAIN=${shop}\n` +
    `STORE_${index}_TOKEN=${token}`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(label)} connected</title></head>
<body style="margin:0;background:#0B0F1A;color:#E2E8F0;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:760px;margin:0 auto;padding:40px 20px">
  <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#22C55E;margin-bottom:6px">Installed</div>
  <h1 style="font-size:24px;margin:0 0 6px">${esc(label)} is connected</h1>
  <p style="font-size:13px;color:#94A3B8;margin:0 0 22px">
    ${esc(shop)} &middot; scopes granted: <code style="color:#C4B5FD">${esc(scopes || "none")}</code>
  </p>

  ${warnings.length ? `<div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);border-radius:8px;padding:12px 14px;margin-bottom:20px;font-size:12px;line-height:1.6">
    ${warnings.map((w) => `&#9888; ${esc(w)}`).join("<br>")}
  </div>` : ""}

  <div style="background:#131825;border:1px solid #1E2A42;border-radius:12px;padding:18px">
    <h2 style="font-size:14px;margin:0 0 4px">Add these three variables in Vercel, then redeploy</h2>
    <p style="font-size:12px;color:#94A3B8;margin:0 0 12px;line-height:1.6">
      Project &rarr; Settings &rarr; Environment Variables. This token is shown once and cannot be
      retrieved again &mdash; reinstall the app if you lose it.
    </p>
    <textarea id="env" readonly rows="3" style="width:100%;box-sizing:border-box;background:#0B0F1A;color:#E2E8F0;border:1px solid #1E2A42;border-radius:8px;padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.7;resize:vertical">${esc(envBlock)}</textarea>
    <button id="copy" style="margin-top:12px;padding:9px 16px;background:#C4B5FD;color:#0B0F1A;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer">Copy all three</button>
    <span id="done" style="margin-left:10px;font-size:12px;color:#22C55E;visibility:hidden">Copied</span>
  </div>

  <p style="font-size:12px;color:#64748B;line-height:1.8;margin-top:22px">
    After redeploying, open <code style="color:#C4B5FD">/api/diagnose</code> to confirm which analytics
    datasets this store returns. Connecting another store? It needs its own Shopify app
    (custom distribution is one store per app) — add that app's credentials as
    <code style="color:#C4B5FD">SHOPIFY_API_KEY_${index + 1}</code> /
    <code style="color:#C4B5FD">SHOPIFY_API_SECRET_${index + 1}</code>, then install with
    <code style="color:#C4B5FD">?slot=${index + 1}</code>.
  </p>
</div>
<script>
  document.getElementById('copy').addEventListener('click', function () {
    var ta = document.getElementById('env');
    ta.select();
    navigator.clipboard.writeText(ta.value).then(function () {
      document.getElementById('done').style.visibility = 'visible';
    });
  });
</script>
</body></html>`;
}
