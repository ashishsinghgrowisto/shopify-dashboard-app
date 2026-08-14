// middleware.js
// Optional password gate for the whole dashboard.
//
// Set DASHBOARD_PASSWORD (and optionally DASHBOARD_USER, default "growisto") to
// require HTTP basic auth. Leave DASHBOARD_PASSWORD unset and the dashboard is open.
//
// This exists because the dashboard aggregates client revenue across brands — a
// public URL would expose every client's numbers to anyone with the link.

import { NextResponse } from "next/server";

export const config = {
  // Everything except Shopify's OAuth callback (Shopify can't send basic auth)
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};

export function middleware(request) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const expectedUser = process.env.DASHBOARD_USER || "growisto";
  const header = request.headers.get("authorization") || "";

  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      if (user === expectedUser && pass === password) return NextResponse.next();
    } catch {
      // fall through to challenge
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Shopify Portfolio Dashboard", charset="UTF-8"' },
  });
}
