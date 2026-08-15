// middleware.js
// Password gate for the agency dashboard.
//
// This dashboard aggregates revenue across every connected client store, so the
// gate FAILS CLOSED: if DASHBOARD_PASSWORD is not set, the dashboard is locked
// rather than public. An unprotected URL here would expose every client's
// numbers to anyone who has the link — including a client who finds it.
//
// Exempt from the gate:
//   /api/auth/*  — Shopify's OAuth callback can't send basic auth
//   /api/sync    — Vercel Cron authenticates with `Authorization: Bearer
//                  $CRON_SECRET`, which this Basic-auth gate would reject
//                  before the route ever ran. The route enforces CRON_SECRET
//                  itself and refuses to run when it isn't set, so exempting
//                  it here doesn't open anything up.
//   /installed   — the neutral page merchants see inside their own Shopify admin
//
// Note these exemptions cover no route that returns cross-client data.

import { NextResponse } from "next/server";

export const config = {
  matcher: ["/((?!api/auth|api/sync|installed|_next/static|_next/image|favicon.ico).*)"],
};

function lockedResponse(message, detail) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard locked</title></head>
<body style="margin:0;background:#0B0F1A;color:#E2E8F0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px">
<div style="background:#131825;border:1px solid #1E2A42;border-radius:14px;padding:30px;max-width:520px">
<h1 style="font-size:19px;margin:0 0 10px">${message}</h1>
<p style="font-size:13px;color:#94A3B8;line-height:1.75;margin:0">${detail}</p>
</div></body></html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export function middleware(request) {
  const password = process.env.DASHBOARD_PASSWORD;

  // Fail closed — never serve cross-client revenue data without a password.
  if (!password) {
    return lockedResponse(
      "Dashboard is locked",
      "No DASHBOARD_PASSWORD is set for this deployment. Because this dashboard combines " +
        "revenue from every connected client store, it stays locked until a password is " +
        "configured. Add DASHBOARD_PASSWORD in your hosting environment variables and redeploy."
    );
  }

  const expectedUser = process.env.DASHBOARD_USER || "growisto";
  const header = request.headers.get("authorization") || "";

  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);

      // Constant-ish time compare to avoid trivially leaking length/prefix
      const ok =
        user.length === expectedUser.length &&
        pass.length === password.length &&
        user === expectedUser &&
        pass === password;

      if (ok) return NextResponse.next();
    } catch {
      // fall through to challenge
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Growisto Portfolio Dashboard", charset="UTF-8"',
      // Never let a client's browser cache a dashboard response
      "Cache-Control": "no-store",
    },
  });
}
